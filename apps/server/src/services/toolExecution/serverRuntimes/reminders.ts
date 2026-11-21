import type { AddReminderParams, CancelReminderParams } from '@lobechat/builtin-tool-reminders';
import { RemindersIdentifier } from '@lobechat/builtin-tool-reminders';

import { addReminder, cancelReminder, listReminders } from '@/server/services/proactive/notes';

import { type ServerRuntimeRegistration } from './types';

/** The reminders tool wherever the server runs tools: phone chat, chat apps, tasks, the gateway. */
export const remindersRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Reminders tool execution');
    }
    const scope = { agentId: context.agentId, db: context.serverDB, userId: context.userId };

    return {
      addReminder: (args: AddReminderParams) => addReminder(scope, args),
      cancelReminder: (args: CancelReminderParams) => cancelReminder(scope, args),
      listReminders: () => listReminders(scope),
    };
  },
  identifier: RemindersIdentifier,
};
