import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { MailApiName } from './types';

export const MailIdentifier = 'lobe-mail';

const ADDRESSES = { items: { type: 'string' }, maxItems: 20, type: 'array' } as const;

export const MailManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "List the newest messages in the user's mailbox that match, newest first, with ids for readMail. Reading does not mark them read.",
      name: MailApiName.searchMail,
      parameters: {
        additionalProperties: false,
        properties: {
          folder: {
            description: 'Folder to look in; INBOX unless the user means another',
            type: 'string',
          },
          limit: {
            description: 'How many, 1 to 20; 10 if not given',
            maximum: 20,
            minimum: 1,
            type: 'integer',
          },
          query: {
            description:
              'Words to find in the subject, the sender or the text, e.g. a name or "invoice"',
            type: 'string',
          },
          since: { description: 'Only messages from this date on, YYYY-MM-DD', type: 'string' },
          unreadOnly: { description: 'Only unread messages', type: 'boolean' },
        },
        type: 'object',
      },
    },
    {
      description:
        'Read one message: who sent it, to whom, when, the subject, the text, and the names of its attachments.',
      name: MailApiName.readMail,
      parameters: {
        additionalProperties: false,
        properties: {
          id: { description: 'The id searchMail gave, like INBOX:1234', type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        "Send a plain-text mail from the user's mailbox, new or as a reply. The user approves it first.",
      humanIntervention: 'required',
      name: MailApiName.sendMail,
      parameters: {
        additionalProperties: false,
        properties: {
          body: {
            description: 'The full text of the mail, signed as the user would',
            type: 'string',
          },
          cc: { ...ADDRESSES, description: 'Mail addresses to copy' },
          replyToId: {
            description:
              'To reply: the id of the message replied to. The subject and thread follow from it.',
            type: 'string',
          },
          subject: {
            description: 'Required for a new mail; for a reply, only to change it',
            type: 'string',
          },
          to: {
            ...ADDRESSES,
            description: 'Mail addresses to send to; at most 20 with cc',
            minItems: 1,
          },
        },
        required: ['to', 'body'],
        type: 'object',
      },
    },
  ],
  identifier: MailIdentifier,
  meta: {
    avatar: '✉️',
    description: "Read and send mail from the user's own mailbox",
    title: 'Mail',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
