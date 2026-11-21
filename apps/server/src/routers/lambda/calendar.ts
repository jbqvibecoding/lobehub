import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { CalendarService } from '@/server/services/calendar';

const procedure = authedProcedure
  .use(serverDatabase)
  .use(async (opts) =>
    opts.next({ ctx: { calendar: new CalendarService(opts.ctx.serverDB, opts.ctx.userId) } }),
  );

const moment = z.string().max(40);
const period = z.object({ from: moment, to: moment });

/**
 * The calendar tool when the web chat runs it in the browser. Each call answers exactly what the
 * server runtime answers the model in the other paths, on the signed-in user's own calendar.
 */
export const calendarRouter = router({
  createEvent: procedure
    .input(
      z.object({
        attendees: z.array(z.string().max(320)).max(20).optional(),
        description: z.string().max(4000).optional(),
        end: moment,
        location: z.string().max(500).optional(),
        start: moment,
        title: z.string().max(200),
      }),
    )
    .mutation(({ ctx, input }) => ctx.calendar.createEvent(input)),

  deleteEvent: procedure
    .input(z.object({ id: z.string().max(200) }))
    .mutation(({ ctx, input }) => ctx.calendar.deleteEvent(input)),

  findFreeTime: procedure
    .input(period.extend({ minutes: z.number().int().optional() }))
    .query(({ ctx, input }) => ctx.calendar.findFreeTime(input)),

  listEvents: procedure.input(period).query(({ ctx, input }) => ctx.calendar.listEvents(input)),

  updateEvent: procedure
    .input(
      z.object({
        description: z.string().max(4000).optional(),
        end: moment.optional(),
        id: z.string().max(200),
        location: z.string().max(500).optional(),
        start: moment.optional(),
        title: z.string().max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.calendar.updateEvent(input)),
});
