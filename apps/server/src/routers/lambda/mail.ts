import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MailService, RECIPIENT_LIMIT } from '@/server/services/mail';

const procedure = authedProcedure
  .use(serverDatabase)
  .use(async (opts) =>
    opts.next({ ctx: { mail: new MailService(opts.ctx.serverDB, opts.ctx.userId) } }),
  );

const addresses = z.array(z.string().max(320)).max(RECIPIENT_LIMIT);

/**
 * The mail tool when the web chat runs it in the browser. Each call answers exactly what the
 * server runtime answers the model in the other paths, from the signed-in user's own mailbox.
 */
export const mailRouter = router({
  read: procedure
    .input(z.object({ id: z.string().max(300) }))
    .query(({ ctx, input }) => ctx.mail.read(input)),

  search: procedure
    .input(
      z.object({
        folder: z.string().max(200).optional(),
        limit: z.number().int().optional(),
        query: z.string().max(200).optional(),
        since: z.string().max(40).optional(),
        unreadOnly: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.mail.search(input)),

  send: procedure
    .input(
      z.object({
        body: z.string().max(50_000),
        cc: addresses.optional(),
        replyToId: z.string().max(300).optional(),
        subject: z.string().max(300).optional(),
        to: addresses,
      }),
    )
    .mutation(({ ctx, input }) => ctx.mail.send(input)),
});
