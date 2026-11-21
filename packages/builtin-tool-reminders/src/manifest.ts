import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { RemindersApiName } from './types';

export const RemindersIdentifier = 'lobe-reminders';

const MOMENT_FORMAT =
  'ISO 8601 date and time with its UTC offset, e.g. 2026-11-25T15:00:00+08:00, worked out from the current time listReminders gives.';

export const RemindersManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Note something to bring up with the user later: a reminder they asked for at a time of their own, or on your own initiative a heads-up before something dated or a follow-up after it. Call listReminders first.',
      name: RemindersApiName.addReminder,
      parameters: {
        additionalProperties: false,
        properties: {
          about: {
            description:
              'What to bring up, as one line that makes sense on its own, in the user’s language, e.g. "Call mom". At most 200 characters. Never a secret.',
            maxLength: 200,
            type: 'string',
          },
          at: {
            description: `When to bring it up. For "asked", exactly the time the user asked for. ${MOMENT_FORMAT}`,
            type: 'string',
          },
          eventAt: {
            description: `When the thing itself happens, if known (an appointment's start, an interview's end). ${MOMENT_FORMAT}`,
            type: 'string',
          },
          kind: {
            description:
              '"asked": the user asked to be reminded, sent at "at". "reminder": your own heads-up before something. "follow_up": your own question after something.',
            enum: ['asked', 'reminder', 'follow_up'],
            type: 'string',
          },
        },
        required: ['kind', 'about', 'at'],
        type: 'object',
      },
    },
    {
      description:
        'List what is waiting to be brought up, with ids, and the current time in the user’s time zone.',
      name: RemindersApiName.listReminders,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description: 'Stop something noted from being brought up, by its id from listReminders.',
      name: RemindersApiName.cancelReminder,
      parameters: {
        additionalProperties: false,
        properties: { id: { description: 'The id listReminders gave', type: 'string' } },
        required: ['id'],
        type: 'object',
      },
    },
  ],
  identifier: RemindersIdentifier,
  meta: {
    avatar: '⏰',
    description: 'Note things to bring up with the user later',
    title: 'Reminders',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
