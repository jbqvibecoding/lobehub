import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { remindersService } from '@/services/reminders';

import { RemindersIdentifier } from '../../manifest';
import type { AddReminderParams, CancelReminderParams } from '../../types';
import { RemindersApiName } from '../../types';

/**
 * Runs the reminders tool from the browser when the web chat executes tools there. Every call goes
 * to the server, which answers the same as it does when it runs the tool itself.
 */
class RemindersExecutor extends BaseExecutor<typeof RemindersApiName> {
  readonly identifier = RemindersIdentifier;
  protected readonly apiEnum = RemindersApiName;

  private run = async (call: () => Promise<BuiltinToolResult>): Promise<BuiltinToolResult> => {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'RemindersRequestFailed' },
        success: false,
      };
    }
  };

  addReminder = (params: AddReminderParams, ctx?: BuiltinToolContext) =>
    this.run(() => remindersService.add(params, ctx?.agentId));

  cancelReminder = (params: CancelReminderParams) =>
    this.run(() => remindersService.cancel(params));

  listReminders = () => this.run(() => remindersService.list());
}

export const remindersExecutor = new RemindersExecutor();
