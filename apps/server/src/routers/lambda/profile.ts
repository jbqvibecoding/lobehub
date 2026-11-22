import { USER_PROFILE_SECTIONS } from '@lobechat/types';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { UserProfileService } from '@/server/services/userProfile';
import { profileToolActions } from '@/server/services/userProfile/tool';

const procedure = authedProcedure.use(serverDatabase);

const id = z.string().min(1).max(16);

/**
 * The user's profile for the web chat: what the context engine gives Biber on each turn, and the
 * profile tool when the browser runs it, answering exactly what the server runtime answers.
 */
export const profileRouter = router({
  confirmEntries: procedure
    .input(z.object({ ids: z.array(id).max(50) }))
    .mutation(({ ctx, input }) =>
      profileToolActions(ctx.serverDB, ctx.userId).confirmEntries(input),
    ),

  dropEntry: procedure
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => profileToolActions(ctx.serverDB, ctx.userId).dropEntry(input)),

  get: procedure.query(async ({ ctx }) => new UserProfileService(ctx.serverDB, ctx.userId).get()),

  saveEntry: procedure
    .input(
      z.object({
        id: id.optional(),
        section: z.enum(USER_PROFILE_SECTIONS),
        text: z.string().max(2000),
      }),
    )
    .mutation(({ ctx, input }) => profileToolActions(ctx.serverDB, ctx.userId).saveEntry(input)),
});
