import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { SavedLoginError, SavedLoginService } from '@/server/services/savedLogins';

const procedure = authedProcedure
  .use(serverDatabase)
  .use(async (opts) =>
    opts.next({ ctx: { logins: new SavedLoginService(opts.ctx.serverDB, opts.ctx.userId) } }),
  );

/**
 * "Saved logins" on the phone: the website logins Biber may sign in with on its cloud computer.
 * The password goes in once, here, and never comes back out: there is no way to read one.
 */
export const loginsRouter = router({
  list: procedure.query(({ ctx }) => ctx.logins.list()),

  /** Saves a login; a refusal says why in its message (`LOGIN_SITE`, `LOGIN_LIMIT`). */
  create: procedure
    .input(
      z.object({
        label: z.string().trim().max(100).optional(),
        password: z.string().min(1).max(500),
        site: z.string().trim().max(500),
        username: z.string().trim().max(320).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.logins.create(input);
      } catch (error) {
        if (error instanceof SavedLoginError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `LOGIN_${error.reason.toUpperCase()}`,
          });
        }
        throw error;
      }
    }),

  delete: procedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => ({ deleted: await ctx.logins.remove(input.id) })),
});
