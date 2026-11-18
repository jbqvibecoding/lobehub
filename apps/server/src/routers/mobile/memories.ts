import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { UserMemoryReviewModel } from '@/database/models/userMemory/review';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const memoryProcedure = authedProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      memories: new UserMemoryReviewModel(opts.ctx.serverDB, opts.ctx.userId),
      persona: new UserPersonaModel(opts.ctx.serverDB, opts.ctx.userId),
    },
  }),
);
const memoryWriteProcedure = memoryProcedure.use(withScopedPermission('message:create'));

/**
 * What Biber remembers about the person, on the phone: read it, forget one thing, or all of it.
 * Forgetting also drops the summary of the person the agent is given, which was written from the
 * memories and may repeat what was forgotten; the next memory extraction writes it again from
 * what is left.
 */
export const memoriesRouter = router({
  forget: memoryWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const forgotten = await ctx.memories.forget(input.id);
      if (forgotten) await ctx.persona.deletePersona();
      return { forgotten };
    }),

  forgetAll: memoryWriteProcedure.mutation(async ({ ctx }) => {
    await ctx.memories.forgetAll();
    await ctx.persona.deletePersona();
    return { forgotten: true };
  }),

  list: memoryProcedure
    .input(z.object({ page: z.number().int().min(1).nullish() }).nullish())
    .query(({ ctx, input }) => ctx.memories.list({ page: input?.page ?? 1 })),
});
