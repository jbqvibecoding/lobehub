import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  reportProactiveDismissed,
  reportProactiveOpened,
} from '@/server/services/proactive/reactions';

const proactiveProcedure = authedProcedure.use(serverDatabase);

const found = <T>(result: T | null) => {
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such message' });
  return result;
};

/** What the user did with messages Biber sent unprompted: the phone reports taps here. */
export const proactiveRouter = router({
  dismiss: proactiveProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      found(await reportProactiveDismissed(ctx.serverDB, ctx.userId, input.id)),
    ),

  opened: proactiveProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      found(await reportProactiveOpened(ctx.serverDB, ctx.userId, input.id)),
    ),
});
