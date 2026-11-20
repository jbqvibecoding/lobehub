import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { ProactiveThoughtModel } from '@/database/models/proactiveThought';
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

const DAY = 24 * 60 * 60 * 1000;

const hour = z.number().int().min(0).max(23);

/** A time zone the runtime knows, e.g. `Asia/Shanghai`. */
const timeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');

/** Messages Biber sends unprompted: the user's settings, what Biber means to say, and taps. */
export const proactiveRouter = router({
  dismiss: proactiveProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      found(await reportProactiveDismissed(ctx.serverDB, ctx.userId, input.id)),
    ),

  /** "Biber won't bring this up": the thought leaves the pending-to-say list for good. */
  dropThought: proactiveProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => ({
      dropped: await new ProactiveThoughtModel(ctx.serverDB, ctx.userId).drop(input.id),
    })),

  getSettings: proactiveProcedure.query(({ ctx }) =>
    new ProactiveSettingsModel(ctx.serverDB, ctx.userId).preferences(),
  ),

  /** What Biber means to bring up, soonest first. */
  listThoughts: proactiveProcedure.query(async ({ ctx }) => {
    const thoughts = await new ProactiveThoughtModel(ctx.serverDB, ctx.userId).listOpen();

    return thoughts
      .map(({ expiresAt, id, kind, occursAt, seed }) => ({ expiresAt, id, kind, occursAt, seed }))
      .sort((a, b) => (a.occursAt?.getTime() ?? Infinity) - (b.occursAt?.getTime() ?? Infinity));
  }),

  opened: proactiveProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      found(await reportProactiveOpened(ctx.serverDB, ctx.userId, input.id)),
    ),

  /**
   * Changes how much Biber speaks up. `quietForDays` pauses unprompted messages for that many
   * days; `null` lifts the pause. The phone also reports its time zone here on launch.
   */
  updateSettings: proactiveProcedure
    .input(
      z.object({
        level: z.enum(['off', 'quiet', 'standard']).optional(),
        quietEnd: hour.optional(),
        quietForDays: z.number().int().min(1).max(30).nullable().optional(),
        quietStart: hour.optional(),
        timeZone: timeZone.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { quietForDays, ...preferences } = input;
      const model = new ProactiveSettingsModel(ctx.serverDB, ctx.userId);

      await model.update({
        ...preferences,
        ...(quietForDays !== undefined && {
          cooldownUntil: quietForDays === null ? null : new Date(Date.now() + quietForDays * DAY),
        }),
      });
      return model.preferences();
    }),
});
