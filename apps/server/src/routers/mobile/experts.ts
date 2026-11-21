import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ExpertService } from '@/server/services/experts';

const expertProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(async (opts) =>
    opts.next({ ctx: { experts: new ExpertService(opts.ctx.serverDB, opts.ctx.userId) } }),
  );

const expertId = z.string().max(64);

/** The expert roster on the phone: see who is on the team, add one with a tap, remove one. */
export const expertsRouter = router({
  add: expertProcedure
    .use(withScopedPermission('agent:create'))
    .input(z.object({ id: expertId, locale: z.string().max(20).optional() }))
    .mutation(async ({ ctx, input }) => {
      const added = await ctx.experts.add(input.id, input.locale ?? 'en-US');
      if (!added) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such expert' });
      return added;
    }),

  list: expertProcedure
    .input(z.object({ locale: z.string().max(20).optional() }).optional())
    .query(({ ctx, input }) => ctx.experts.list(input?.locale ?? 'en-US')),

  remove: expertProcedure
    .use(withScopedPermission('agent:delete'))
    .input(z.object({ id: expertId }))
    .mutation(async ({ ctx, input }) => ({ removed: await ctx.experts.remove(input.id) })),
});
