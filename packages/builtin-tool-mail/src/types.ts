export const MailApiName = {
  /** One message in full */
  readMail: 'readMail',

  /** The newest messages that match */
  searchMail: 'searchMail',

  /** A new mail or a reply, after the user approves it */
  sendMail: 'sendMail',
} as const;

export type MailApiNameType = (typeof MailApiName)[keyof typeof MailApiName];

export interface SearchMailParams {
  folder?: string;
  limit?: number;
  query?: string;
  since?: string;
  unreadOnly?: boolean;
}

export interface ReadMailParams {
  id: string;
}

export interface SendMailParams {
  body: string;
  cc?: string[];
  replyToId?: string;
  subject?: string;
  to: string[];
}
