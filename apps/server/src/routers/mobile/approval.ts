import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AiAgentService } from '@/server/services/aiAgent';

const approvalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId }),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

/**
 * The phone as an approver: list the tool calls waiting for the user, and answer one. Answering
 * resumes the paused run through `execAgent`'s `resumeApproval`, the path the web client uses.
 */
export const approvalRouter = router({
  listPending: approvalProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => ctx.messageModel.listPendingInterventions(input?.limit)),

  respond: approvalProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        decision: z.enum(['approved', 'rejected']),
        /** Shown to the agent when the call is refused. */
        reason: z.string().max(2000).optional(),
        toolMessageId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { decision, reason, toolMessageId } = input;

      const [plugin, message] = await Promise.all([
        ctx.messageModel.findMessagePlugin(toolMessageId),
        ctx.messageModel.findById(toolMessageId),
      ]);

      if (!plugin || !message || message.role !== 'tool' || !message.agentId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No such tool call' });
      }
      if (!plugin.toolCallId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This tool call has no id to resume' });
      }

      // Another device (or a second tap) may have answered first; only one answer resumes the run
      if (!(await ctx.messageModel.claimPendingIntervention(toolMessageId, decision))) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This tool call was already answered' });
      }

      const result = await ctx.aiAgentService.execAgent({
        agentId: message.agentId,
        appContext: {
          groupId: message.groupId,
          threadId: message.threadId,
          topicId: message.topicId,
        },
        parentMessageId: toolMessageId,
        prompt: '',
        resume: true,
        resumeApproval: {
          decision,
          parentMessageId: toolMessageId,
          rejectionReason: reason,
          toolCallId: plugin.toolCallId,
        },
        trigger: RequestTrigger.Chat,
        // Later calls in the resumed run ask again rather than running unattended
        userInterventionConfig: { approvalMode: 'manual' },
      });

      return { operationId: result.operationId };
    }),
});
