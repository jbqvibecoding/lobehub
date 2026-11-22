import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ComputerToolsService } from '@/server/services/computerTools';

const procedure = authedProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: { serverDB: opts.ctx.serverDB, userId: opts.ctx.userId },
  }),
);

const withTopic = z.object({ topicId: z.string().max(64).optional() });
const ref = z.string().trim().min(1).max(40);
const snapshotId = z.number().int().nonnegative();
const name = z.string().max(500);
const site = z.string().max(500);
const key = z.string().trim().min(1).max(40);

const service = (ctx: { serverDB: any; userId: string }, topicId?: string) =>
  new ComputerToolsService(ctx.serverDB, ctx.userId, topicId);

/**
 * The cloud computer's browser when the web chat runs Biber's tools in the browser. Each call
 * answers what the server runtime answers the model in the other paths, on the signed-in user's
 * own computer; the topic picks the computer where each conversation has its own.
 */
export const computerToolsRouter = router({
  click: procedure
    .input(withTopic.extend({ ref, snapshotId }))
    .mutation(({ ctx, input: { topicId, ...args } }) => service(ctx, topicId).click(args)),

  clickWithApproval: procedure
    .input(withTopic.extend({ element: name, ref, site, snapshotId }))
    .mutation(({ ctx, input: { topicId, ...args } }) =>
      service(ctx, topicId).clickWithApproval(args),
    ),

  navigate: procedure
    .input(withTopic.extend({ url: z.string().trim().min(1).max(4000) }))
    .mutation(({ ctx, input: { topicId, ...args } }) => service(ctx, topicId).navigate(args)),

  pressKey: procedure
    .input(withTopic.extend({ key, ref: ref.optional(), snapshotId: snapshotId.optional() }))
    .mutation(({ ctx, input: { topicId, ...args } }) => service(ctx, topicId).pressKey(args)),

  pressKeyWithApproval: procedure
    .input(withTopic.extend({ element: name, key, ref: ref.optional(), site, snapshotId }))
    .mutation(({ ctx, input: { topicId, ...args } }) =>
      service(ctx, topicId).pressKeyWithApproval(args),
    ),

  read: procedure.input(withTopic).mutation(({ ctx, input }) => service(ctx, input.topicId).read()),

  requestHelp: procedure
    .input(withTopic.extend({ reason: z.string().max(2000) }))
    .mutation(({ ctx, input: { topicId, ...args } }) => service(ctx, topicId).requestHelp(args)),

  scroll: procedure
    .input(withTopic.extend({ deltaY: z.number().int().min(-20_000).max(20_000).optional() }))
    .mutation(({ ctx, input: { topicId, ...args } }) => service(ctx, topicId).scroll(args)),

  snapshot: procedure
    .input(withTopic)
    .mutation(({ ctx, input }) => service(ctx, input.topicId).snapshot()),

  type: procedure
    .input(
      withTopic.extend({
        ref,
        snapshotId,
        submit: z.boolean().optional(),
        text: z.string().max(20_000),
      }),
    )
    .mutation(({ ctx, input: { topicId, ...args } }) => service(ctx, topicId).type(args)),
});
