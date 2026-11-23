import { findSecrets, parseToolArguments } from '@lobechat/agent-policy';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { answerToolApproval, ToolApprovalError } from '@/server/services/toolApproval';

const approvalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, workspaceId),
      workspaceId,
    },
  });
});

/**
 * The phone as an approver: list the tool calls waiting for the user, and answer one. Answering
 * resumes the paused run the same way a chat button or the web client does.
 */
export const approvalRouter = router({
  listPending: approvalProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const pending = await ctx.messageModel.listPendingInterventions({ limit: input?.limit });
      // Says on the card what the call would send out that looks like a secret
      return pending.map((item) => ({
        ...item,
        secrets: findSecrets(parseToolArguments(item.arguments ?? undefined)),
      }));
    }),

  respond: approvalProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        /** The answer to a coding expert's question, with `approved` */
        answer: z
          .record(
            z.string().max(2000),
            z.union([z.string().max(4000), z.array(z.string().max(2000))]),
          )
          .optional(),
        decision: z.enum(['approved', 'rejected']),
        /** Shown to the agent when the call is refused. */
        reason: z.string().max(2000).optional(),
        toolMessageId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await answerToolApproval(ctx.serverDB, {
          ...input,
          userId: ctx.userId,
          via: 'mobile',
          workspaceId: ctx.workspaceId,
        });
      } catch (error) {
        if (error instanceof ToolApprovalError) {
          throw new TRPCError({ code: error.code, message: error.message });
        }
        throw error;
      }
    }),
});
