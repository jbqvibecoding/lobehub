import type { ReadMailParams, SearchMailParams, SendMailParams } from '@lobechat/builtin-tool-mail';
import { MailIdentifier } from '@lobechat/builtin-tool-mail';

import { MailService } from '@/server/services/mail';

import { type ServerRuntimeRegistration } from './types';

/** The mail tool wherever the server runs tools: phone chat, chat apps, tasks, the gateway. */
export const mailRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Mail tool execution');
    }
    const mail = new MailService(context.serverDB, context.userId);

    return {
      readMail: (args: ReadMailParams) => mail.read(args),
      searchMail: (args: SearchMailParams) => mail.search(args),
      sendMail: (args: SendMailParams) => mail.send(args),
    };
  },
  identifier: MailIdentifier,
};
