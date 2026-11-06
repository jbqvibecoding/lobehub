import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentActionAuditModel } from '@/database/models/agentActionAudit';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const DEFAULT_PAGE_SIZE = 30;

const activityProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: { auditModel: new AgentActionAuditModel(opts.ctx.serverDB, opts.ctx.userId) },
  }),
);

/** The phone's view of what agents did for the user: asked, answered, blocked and ran. */
export const activityRouter = router({
  list: activityProcedure
    .input(
      z
        .object({
          /** Id of the last event of the previous page */
          cursor: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? DEFAULT_PAGE_SIZE;
      const rows = await ctx.auditModel.list({ cursor: input?.cursor, limit: limit + 1 });
      const items = rows.slice(0, limit);

      return { items, nextCursor: rows.length > limit ? items.at(-1)?.id : undefined };
    }),
});
