import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { describeApprovalCall } from '@/server/services/toolApproval/describe';

const log = debug('lobe-server:mobile:chat');

const chatProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId, { workspaceId }),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId }),
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

/** One line of a conversation on the phone: what was said, and what the agent did. */
export type ChatLine =
  | { createdAt: Date; id: string; kind: 'user' | 'assistant'; text: string }
  | {
      apiName?: string;
      arguments?: string;
      createdAt: Date;
      id: string;
      identifier?: string;
      kind: 'tool';
      /** `waiting` is a call the user has not answered yet; the phone answers it in place. */
      status: 'done' | 'failed' | 'rejected' | 'waiting';
      title: string;
      type: string;
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

/**
 * Chat on the phone: send a message to an agent (Biber by default), read the conversation back,
 * and stop a run. Runs started here wait for the user's answer on any call that needs approval,
 * as the web app does; the phone answers through `approval.respond`.
 */
export const chatRouter = router({
  history: chatProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }): Promise<{ lines: ChatLine[]; run: ChatRunState }> => {
      const topic = await ctx.topicModel.findById(input.topicId);
      if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such conversation' });

      const rows = (await ctx.messageModel.query({ topicId: input.topicId })) as any[];
      const lines: ChatLine[] = [];
      for (const row of rows) {
        if (row.role === 'user' || row.role === 'assistant') {
          const text = typeof row.content === 'string' ? row.content.trim() : '';
          if (text) lines.push({ createdAt: row.createdAt, id: row.id, kind: row.role, text });
          continue;
        }
        if (row.role === 'tool' && row.plugin?.apiName) {
          const { apiName, arguments: args, identifier, type } = row.plugin;
          lines.push({
            apiName,
            arguments: args ?? undefined,
            createdAt: row.createdAt,
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
      }

      return { lines, run };
    }),

  /**
   * Sends a message. Without a conversation it starts one with `agentId`, or with Biber when no
   * agent is named; with one, it continues there.
   */
  send: chatProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        agentId: z.string().optional(),
        text: z.string().trim().min(1).max(8000),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let agentId = input.agentId;
      if (input.topicId) {
        const topic = await ctx.topicModel.findById(input.topicId);
        if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such conversation' });
        agentId = topic.agentId ?? agentId;
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
