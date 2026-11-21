import type { ReadMailParams, SearchMailParams, SendMailParams } from '@lobechat/builtin-tool-mail';

import { lambdaClient } from '@/libs/trpc/client';

/** The mail tool, run from the web chat's browser: the server holds the mailbox and does the work. */
export const mailService = {
  read: (params: ReadMailParams) => lambdaClient.mail.read.query(params),

  search: (params: SearchMailParams) => lambdaClient.mail.search.query(params),

  send: (params: SendMailParams) => lambdaClient.mail.send.mutate(params),
};
