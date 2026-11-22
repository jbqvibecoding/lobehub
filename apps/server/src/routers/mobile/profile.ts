import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { RequestTrigger, USER_PROFILE_SECTIONS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AiAgentService } from '@/server/services/aiAgent';
import { UserProfileService } from '@/server/services/userProfile';

const log = debug('lobe-server:mobile:profile');

const profileProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, workspaceId),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId }),
      profile: new UserProfileService(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

/** What the phone says for the user to open or reopen the interview, in their language. */
const WORDS = {
  en: { carryOn: 'Let’s carry on', start: 'Let’s start', title: 'About you' },
  zh: { carryOn: '我们继续吧', start: '我们开始吧', title: '关于你' },
};

const wordsFor = (locale?: string) =>
  locale?.toLowerCase().startsWith('zh') ? WORDS.zh : WORDS.en;

/**
 * The "About you" interview from the phone: Biber gets to know the user in a conversation of its
 * own, and what it learns goes into their profile.
 */
/** What the phone shows for why an entry was not saved (see `SAVE_FAILURES` on the phone). */
const refusal = (outcome: { message: string; ok: false; reason: string }) =>
  new TRPCError({
    code: outcome.reason === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST',
    message: `PROFILE_${outcome.reason.toUpperCase()}`,
  });

const id = z.string().min(1).max(16);

export const profileRouter = router({
  /** Whether to invite the user to the interview, above the chat list. */
  status: profileProcedure.query(async ({ ctx }) => ({ invite: await ctx.profile.inviteDue() })),

  /** The user said "Later" to the invite. */
  dismissInvite: profileProcedure.mutation(async ({ ctx }) => {
    await ctx.profile.dismissInvite();
    return { invite: false };
  }),

  /** "About you": what the user told Biber, and where the interview stands. */
  get: profileProcedure.query(({ ctx }) => ctx.profile.get()),

  /** Changes an entry's words (it keeps its id), or adds one. */
  saveEntry: profileProcedure
    .input(
      z.object({
        id: id.optional(),
        section: z.enum(USER_PROFILE_SECTIONS),
        text: z.string().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await ctx.profile.saveEntry(input);
      if (!outcome.ok) throw refusal(outcome);
      return outcome.entry;
    }),

  /** Deletes an entry; its id is not given again. */
  dropEntry: profileProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const outcome = await ctx.profile.dropEntry(input.id);
    if (!outcome.ok) throw refusal(outcome);
    return { id: input.id };
  }),

  /** Deletes everything the user told Biber about themselves. Memories are not touched. */
  clear: profileProcedure.mutation(async ({ ctx }) => {
    await ctx.profile.clear();
    return { cleared: true };
  }),

  /**
   * Opens the interview: continues its conversation if there is one, or starts it, with a first
   * line from the user so Biber begins. Returns the conversation for the phone to open.
   */
  startInterview: profileProcedure
    .use(withScopedPermission('message:create'))
    .input(z.object({ locale: z.string().max(20).optional() }))
    .mutation(async ({ ctx, input }) => {
      const words = wordsFor(input.locale);
      const { interview } = await ctx.profile.get();
      const existing = interview.topicId
        ? await ctx.topicModel.findById(interview.topicId)
        : undefined;

      const running = existing?.metadata?.runningOperation?.operationId;
      if (existing && running) {
        await ctx.profile.startInterview(existing.id);
        log('startInterview: %s is already running', existing.id);
        return { operationId: running, topicId: existing.id };
      }

      // The conversation is made and recorded before Biber runs, so its very first call already
      // carries the interview's instructions.
      let topicId = existing?.id;
      let agentId = existing?.agentId ?? undefined;
      if (!topicId || !agentId) {
        const biber = await ctx.agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
        if (!biber) throw new TRPCError({ code: 'NOT_FOUND', message: 'Biber is not set up' });
        agentId = biber.id;
      }
      if (!topicId) {
        const topic = await ctx.topicModel.create({
          agentId,
          title: words.title,
          trigger: RequestTrigger.Chat,
        });
        topicId = topic.id;
      }
      await ctx.profile.startInterview(topicId);

      log('startInterview: %s in %s', existing ? 'carrying on' : 'starting', topicId);
      const result = await ctx.aiAgentService.execAgent({
        agentId,
        appContext: { topicId },
        prompt: existing ? words.carryOn : words.start,
        trigger: RequestTrigger.Chat,
        // The person is right here: calls that need approval wait for their answer
        userInterventionConfig: { approvalMode: 'manual' },
      });
      return { operationId: result.operationId, topicId };
    }),
});
