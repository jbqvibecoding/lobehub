export const RemindersApiName = {
  /** Note something to bring up with the user later */
  addReminder: 'addReminder',

  /** Stop something noted from being brought up */
  cancelReminder: 'cancelReminder',

  /** What is waiting to be brought up, and the current time in the user's time zone */
  listReminders: 'listReminders',
} as const;

export type RemindersApiNameType = (typeof RemindersApiName)[keyof typeof RemindersApiName];

export type ReminderKind = 'asked' | 'follow_up' | 'reminder';

export interface AddReminderParams {
  about: string;
  at: string;
  eventAt?: string;
  kind: ReminderKind;
}

export interface CancelReminderParams {
  id: string;
}
