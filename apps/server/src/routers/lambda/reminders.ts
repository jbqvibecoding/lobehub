import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { addReminder, cancelReminder, listReminders } from '@/server/services/proactive/notes';

const procedure = authedProcedure.use(serverDatabase);

/** The browser's time zone: the device the user is on, which beats any stored one. */
const timeZone = z.string().max(64).optional();

/**
 * The reminders tool when the web chat runs it in the browser. Each call answers exactly what the
 * server runtime answers the model in the other paths (phone, chat apps, tasks), and only ever
 * reaches the signed-in user's own list.
 */
export const remindersRouter = router({
  add: procedure
    .input(
      z.object({
        about: z.string().max(1000),
        agentId: z.string().optional(),
        at: z.string().max(64),
        eventAt: z.string().max(64).optional(),
        kind: z.enum(['asked', 'follow_up', 'reminder']),
        timeZone,
      }),
    )
    .mutation(({ ctx, input: { agentId, timeZone, ...reminder } }) =>
      addReminder({ agentId, db: ctx.serverDB, timeZone, userId: ctx.userId }, reminder),
    ),

  cancel: procedure
    .input(z.object({ id: z.string().max(64) }))
    .mutation(({ ctx, input }) => cancelReminder({ db: ctx.serverDB, userId: ctx.userId }, input)),

  list: procedure
    .input(z.object({ timeZone }).optional())
    .query(({ ctx, input }) =>
      listReminders({ db: ctx.serverDB, timeZone: input?.timeZone, userId: ctx.userId }),
    ),
});
