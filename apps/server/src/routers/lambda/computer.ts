import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { CloudComputerService } from '@/server/services/cloudComputer';

/** Which conversation's computer, where each conversation has its own (OPENBOT_COMPUTER_SCOPE=topic). */
const scope = { topicId: z.string().optional() };

/** Coordinates are pixels of the screenshot the person is looking at, which is the page's size. */
const pixel = z.number().finite().min(0).max(10_000);

const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: pixel, y: pixel }),
  // Playwright key names and chords: Enter, Backspace, ArrowDown, Control+A, Meta+V…
  z.object({ key: z.string().regex(/^[\w+]{1,40}$/), kind: z.literal('key') }),
  z.object({ deltaY: z.number().finite().min(-5000).max(5000), kind: z.literal('scroll') }),
  z.object({ kind: z.literal('type'), text: z.string().min(1).max(5000) }),
]);

const computerFor = (userId: string, input?: { topicId?: string } | null) =>
  new CloudComputerService(userId, input?.topicId);

/**
 * The user's cloud computer, on the web, the desktop app and the phone: watch it, take the browser
 * from the assistant, click and type, and hand it back.
 */
export const computerRouter = router({
  handBack: authedProcedure
    .input(z.object(scope).nullish())
    .mutation(({ ctx, input }) => computerFor(ctx.userId, input).handBack()),

  input: authedProcedure
    .input(z.object({ ...scope, action: actionSchema }))
    .mutation(({ ctx, input }) => computerFor(ctx.userId, input).input(input.action)),

  start: authedProcedure
    .input(z.object(scope).nullish())
    .mutation(({ ctx, input }) => computerFor(ctx.userId, input).start()),

  /** The value Biber asked for, typed by the person; it goes to the page and nowhere else. */
  supplySecret: authedProcedure
    .input(z.object({ ...scope, text: z.string().min(1).max(500) }))
    .mutation(({ ctx, input }) => computerFor(ctx.userId, input).supplySecret(input.text)),

  takeOver: authedProcedure
    .input(z.object(scope).nullish())
    .mutation(({ ctx, input }) => computerFor(ctx.userId, input).takeOver()),

  view: authedProcedure
    .input(z.object({ ...scope, withScreen: z.boolean().optional() }).nullish())
    .query(({ ctx, input }) =>
      computerFor(ctx.userId, input).view({ withScreen: input?.withScreen }),
    ),
});
