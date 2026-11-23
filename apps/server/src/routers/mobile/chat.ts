import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { GROUP_MEMBER_LIMIT, GroupChatService } from '@/server/services/experts/groupChat';
import { describeApprovalCall } from '@/server/services/toolApproval/describe';

const log = debug('lobe-server:mobile:chat');

const HETERO_PROVIDERS = new Set(['claude-code', 'codex']);

/** Whether an operation is a Claude Code / Codex run that has not finished. */
const isHeteroRunGoing = async (db: LobeChatDatabase, userId: string, operationId: string) => {
  const [row] = await db
    .select({ provider: agentOperations.provider, status: agentOperations.status })
    .from(agentOperations)
    .where(and(eq(agentOperations.id, operationId), eq(agentOperations.userId, userId)))
    .limit(1);
  return row?.status === 'running' && HETERO_PROVIDERS.has(row.provider ?? '');
};

const chatProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId, { workspaceId }),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId }),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, workspaceId),
      groupChat: new GroupChatService(ctx.serverDB, ctx.userId, workspaceId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, workspaceId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

/**
 * Where a conversation's latest run stands, as the phone shows it: still writing (`running`),
 * waiting for the user's yes or no (`waiting`), or done (`idle`). A run the runtime no longer
 * knows about has finished.
 */
export type ChatRunState = 'idle' | 'running' | 'waiting';

/**
 * One line of a conversation on the phone: what was said, and what the agent did. In a group chat,
 * `agentId` says who answered (see `speakers`).
 */
export type ChatLine =
  | { agentId?: string; createdAt: Date; id: string; kind: 'user' | 'assistant'; text: string }
  | {
      apiName?: string;
      arguments?: string;
      createdAt: Date;
      /** A file the call handed over (an export from the cloud computer), to open from the chat */
      file?: ChatFile;
      id: string;
      identifier?: string;
      kind: 'tool';
      /** `waiting` is a call the user has not answered yet; the phone answers it in place. */
      status: 'done' | 'failed' | 'rejected' | 'waiting';
      title: string;
      type: string;
    };

/** A file handed over in the chat: its name, and where to open it. */
export interface ChatFile {
  id: string;
  mimeType?: string;
  name: string;
  size?: number;
  /** Absolute, for the phone to open */
  url: string;
}

/** A link the phone can open: file links are stored relative to this server. */
const absoluteUrl = (url: string) => {
  try {
    return new URL(url, appEnv.APP_URL).toString();
  } catch {
    return url;
  }
};

/** The file a call handed over, if it was an export that succeeded. */
const deliveredFile = (row: {
  plugin?: { apiName?: string; identifier?: string };
  pluginState?: unknown;
}): ChatFile | undefined => {
  if (row.plugin?.identifier !== 'lobe-cloud-sandbox' || row.plugin.apiName !== 'exportFile')
    return;
  const state = row.pluginState as
    | {
        downloadUrl?: string;
        fileId?: string;
        filename?: string;
        mimeType?: string;
        size?: number;
        success?: boolean;
      }
    | undefined;
  if (!state?.success || !state.downloadUrl || !state.fileId || !state.filename) return;
  return {
    id: state.fileId,
    mimeType: state.mimeType,
    name: state.filename,
    size: state.size,
    url: absoluteUrl(state.downloadUrl),
  };
};

const toolStatus = (row: {
  pluginError?: unknown;
  pluginIntervention?: { status?: string } | null;
}): Extract<ChatLine, { kind: 'tool' }>['status'] => {
  const intervention = row.pluginIntervention?.status;
  if (intervention === 'pending') return 'waiting';
  if (intervention === 'rejected') return 'rejected';
  return row.pluginError ? 'failed' : 'done';
};

/** Who speaks in a conversation, by agent id, for the name and avatar above their messages. */
export type ChatSpeakers = Record<
  string,
  { avatar: string | null; backgroundColor: string | null; isHost?: boolean; title: string }
>;

/** The group's own orchestration calls: the experts' answers that follow them say it all. */
const GROUP_TOOL = 'lobe-group-management';

const expertIds = z.array(z.string().max(64)).max(GROUP_MEMBER_LIMIT);

/**
 * Chat on the phone: send a message to an agent (Biber by default) or to a group Biber hosts with
 * the user's experts, read the conversation back, and stop a run. Runs started here wait for the
 * user's answer on any call that needs approval, as the web app does; the phone answers through
 * `approval.respond`.
 */
export const chatRouter = router({
  /** Starts a group chat Biber hosts with some of the user's experts. */
  startGroup: chatProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        expertIds: expertIds.min(1),
        locale: z.string().max(20).optional(),
        title: z.string().max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.groupChat.start({
        expertIds: input.expertIds,
        locale: input.locale ?? 'en-US',
        title: input.title,
      }),
    ),

  /** A group chat's name and who is in it, Biber first. */
  group: chatProcedure
    .input(z.object({ groupId: z.string() }))
    .query(({ ctx, input }) => ctx.groupChat.describe(input.groupId)),

  /** Adds or removes experts; Biber hosts and stays. */
  updateGroup: chatProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        addExpertIds: expertIds.optional(),
        groupId: z.string(),
        removeExpertIds: expertIds.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({ members: await ctx.groupChat.update(input) })),

  history: chatProcedure.input(z.object({ topicId: z.string() })).query(
    async ({
      ctx,
      input,
    }): Promise<{
      /** In a chat with one agent: who it is with (see `speakers`). */
      agentId?: string;
      groupId?: string;
      lines: ChatLine[];
      run: ChatRunState;
      speakers: ChatSpeakers;
    }> => {
      const topic = await ctx.topicModel.findById(input.topicId);
      if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such conversation' });
      const groupId = topic.groupId ?? undefined;

      const rows = (await ctx.messageModel.query({ groupId, topicId: input.topicId })) as any[];
      const lines: ChatLine[] = [];
      for (const row of rows) {
        if (row.role === 'user' || row.role === 'assistant') {
          const text = typeof row.content === 'string' ? row.content.trim() : '';
          if (text) {
            lines.push({
              ...(groupId && row.role === 'assistant' && row.agentId && { agentId: row.agentId }),
              createdAt: row.createdAt,
              id: row.id,
              kind: row.role,
              text,
            });
          }
          continue;
        }
        if (groupId && row.plugin?.identifier === GROUP_TOOL) continue;
        if (row.role === 'tool' && row.plugin?.apiName) {
          const { apiName, arguments: args, identifier, type } = row.plugin;
          const file = deliveredFile(row);
          lines.push({
            apiName,
            arguments: args ?? undefined,
            createdAt: row.createdAt,
            ...(file && { file }),
            id: row.id,
            identifier: identifier ?? undefined,
            kind: 'tool',
            status: toolStatus(row),
            title: describeApprovalCall({ apiName, identifier: identifier ?? undefined }).title,
            type: type ?? 'default',
          });
        }
      }

      const operationId = topic.metadata?.runningOperation?.operationId;
      let run: ChatRunState = lines.some(
        (line) => line.kind === 'tool' && line.status === 'waiting',
      )
        ? 'waiting'
        : 'idle';
      if (run === 'idle' && operationId) {
        const status = await ctx.agentRuntimeService
          .getOperationStatus({ operationId })
          .catch(() => null);
        if (status?.needsHumanInput) run = 'waiting';
        else if (status?.isActive) run = 'running';
        // A Claude Code / Codex run is not in the runtime's registry; its operation row says
        else if (await isHeteroRunGoing(ctx.serverDB, ctx.userId, operationId)) run = 'running';
      }

      const speakers: ChatSpeakers = {};
      if (groupId) {
        for (const member of await ctx.groupChat.members(groupId)) {
          speakers[member.id] = {
            avatar: member.avatar,
            backgroundColor: member.backgroundColor,
            isHost: member.isHost,
            title: member.title,
          };
        }
        return { groupId, lines, run, speakers };
      }

      const agentId = topic.agentId ?? undefined;
      if (agentId) {
        const [agent] = await ctx.agentModel.getAgentAvatarsByIds([agentId]);
        if (agent) {
          speakers[agentId] = {
            avatar: agent.avatar,
            backgroundColor: agent.backgroundColor,
            // Biber's title is filled in by the model; another agent may have none
            title: agent.title || '',
          };
        }
      }
      return { ...(agentId && { agentId }), lines, run, speakers };
    },
  ),

  /**
   * Sends a message. Without a conversation it starts one with `agentId`, with the group in
   * `groupId`, or with Biber when neither is named; with one, it continues there. In a group,
   * `mentions` are the experts the user addressed.
   */
  send: chatProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        agentId: z.string().optional(),
        groupId: z.string().optional(),
        mentions: expertIds.optional(),
        text: z.string().trim().min(1).max(8000),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let agentId = input.agentId;
      let groupId = input.groupId;
      if (input.topicId) {
        const topic = await ctx.topicModel.findById(input.topicId);
        if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such conversation' });
        agentId = topic.agentId ?? agentId;
        groupId = topic.groupId ?? undefined;
      }

      if (groupId) {
        log('send: group=%s topic=%s', groupId, input.topicId ?? 'new');
        return ctx.groupChat.send({
          groupId,
          mentions: input.mentions,
          text: input.text,
          topicId: input.topicId,
        });
      }

      log('send: topic=%s agent=%s', input.topicId ?? 'new', agentId ?? 'biber');
      const result = await ctx.aiAgentService.execAgent({
        agentId,
        appContext: input.topicId ? { topicId: input.topicId } : undefined,
        prompt: input.text,
        slug: agentId ? undefined : BUILTIN_AGENT_SLUGS.inbox,
        trigger: RequestTrigger.Chat,
        // The person is right here: calls that need approval wait for their answer
        userInterventionConfig: { approvalMode: 'manual' },
      });

      return { operationId: result.operationId, topicId: result.topicId };
    }),

  /** Stops the conversation's current run, if one is going. */
  stop: chatProcedure
    .use(withScopedPermission('message:create'))
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const topic = await ctx.topicModel.findById(input.topicId);
      const operationId = topic?.metadata?.runningOperation?.operationId;
      if (!operationId) return { stopped: false };

      const result = await ctx.aiAgentService.interruptTask({
        operationId,
        topicId: input.topicId,
      });
      return { stopped: !!result?.success };
    }),
});
