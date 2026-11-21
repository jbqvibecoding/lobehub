import type { AddReminderParams, CancelReminderParams } from '@lobechat/builtin-tool-reminders';

import { lambdaClient } from '@/libs/trpc/client';

/** The zone of the device the user is chatting on, sent with each call so times mean theirs. */
const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/** The reminders tool, run from the web chat's browser: the server does the work. */
export const remindersService = {
  add: (params: AddReminderParams, agentId?: string) =>
    lambdaClient.reminders.add.mutate({ ...params, agentId, timeZone: browserTimeZone() }),

  cancel: (params: CancelReminderParams) => lambdaClient.reminders.cancel.mutate(params),

  list: () => lambdaClient.reminders.list.query({ timeZone: browserTimeZone() }),
};
