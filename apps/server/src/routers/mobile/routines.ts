import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { StarterRoutineService } from '@/server/services/starterRoutines';

const routineProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: { routines: new StarterRoutineService(opts.ctx.serverDB, opts.ctx.userId) },
  }),
);

/** Starter routines on the phone: the morning brief and friends, turned on with one tap. */
export const routinesRouter = router({
  disable: routineProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => ctx.routines.disable(input)),

  enable: routineProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({ id: z.string(), locale: z.string().optional(), timeZone: z.string().optional() }),
    )
    .mutation(({ ctx, input }) => ctx.routines.enable(input)),

  list: routineProcedure
    .input(z.object({ locale: z.string().optional() }).optional())
    .query(({ ctx, input }) => ctx.routines.list(input?.locale)),
});
