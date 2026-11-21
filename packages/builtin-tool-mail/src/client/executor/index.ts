import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { mailService } from '@/services/mail';

import { MailIdentifier } from '../../manifest';
import type { ReadMailParams, SearchMailParams, SendMailParams } from '../../types';
import { MailApiName } from '../../types';

/**
 * Runs the mail tool from the browser when the web chat executes tools there. Every call goes to
 * the server, which holds the mailbox login and answers as it does when it runs the tool itself.
 */
class MailExecutor extends BaseExecutor<typeof MailApiName> {
  readonly identifier = MailIdentifier;
  protected readonly apiEnum = MailApiName;

  private run = async (call: () => Promise<BuiltinToolResult>): Promise<BuiltinToolResult> => {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: message, error: { message, type: 'MailRequestFailed' }, success: false };
    }
  };

  readMail = (params: ReadMailParams) => this.run(() => mailService.read(params));

  searchMail = (params: SearchMailParams) => this.run(() => mailService.search(params));

  sendMail = (params: SendMailParams) => this.run(() => mailService.send(params));
}

export const mailExecutor = new MailExecutor();
