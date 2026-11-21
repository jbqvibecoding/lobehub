import { isIP } from 'node:net';

import type { FetchMessageObject, MessageAddressObject } from 'imapflow';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { IMAP_PORTS, resolveMailHost } from './host';

/** Who Biber says it is to the mail server: NetEase (163, 126) refuses clients that do not say. */
const CLIENT_INFO = { name: 'Biber', vendor: 'Biber', version: '1.0' };
const TIMEOUT_MS = 20_000;
/** Mail read to the model, at most: a long thread or newsletter is cut here */
const TEXT_LIMIT = 20_000;

export interface MailLogin {
  host: string;
  password: string;
  port: number;
  user: string;
}

/** Opens an IMAP session over SSL (993) or STARTTLS (143), required either way. */
export const openImap = async ({ host, password, port, user }: MailLogin) => {
  const target = await resolveMailHost(host, port, IMAP_PORTS);
  const client = new ImapFlow({
    auth: { pass: password, user },
    clientInfo: CLIENT_INFO,
    connectionTimeout: TIMEOUT_MS,
    disableAutoIdle: true,
    doSTARTTLS: port === 993 ? undefined : true,
    greetingTimeout: TIMEOUT_MS,
    host: target.address,
    logger: false,
    port,
    secure: port === 993,
    servername: isIP(target.servername) ? undefined : target.servername,
    socketTimeout: TIMEOUT_MS * 3,
    tls: {
      rejectUnauthorized: !target.trustSelfSigned,
      ...(!isIP(target.servername) && { servername: target.servername }),
    },
  });
  await client.connect();
  return client;
};

/** Runs `work` on a fresh session and logs out after, however `work` ends. */
export const withImap = async <T>(login: MailLogin, work: (client: ImapFlow) => Promise<T>) => {
  const client = await openImap(login);
  try {
    return await work(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
};

/** Where sent mail goes: the folder the server marks as Sent, else the usual names. */
export const findSentFolder = async (client: ImapFlow) => {
  const folders = await client.list();
  return (
    folders.find((folder) => folder.specialUse === '\\Sent')?.path ??
    folders.find((folder) => /^(?:sent(?: messages| items)?|已发送)$/i.test(folder.name))?.path
  );
};

const address = (entry?: MessageAddressObject) =>
  entry ? (entry.name ? `${entry.name} <${entry.address}>` : (entry.address ?? '')) : '';

export interface MailSummary {
  date?: string;
  from: string;
  /** `<folder>:<uid>`, what readMail takes */
  id: string;
  subject: string;
  unread: boolean;
}

export interface MailSearch {
  folder: string;
  limit: number;
  query?: string;
  since?: Date;
  unreadOnly?: boolean;
}

const summarize = (folder: string, message: FetchMessageObject): MailSummary => ({
  date: message.envelope?.date ? new Date(message.envelope.date).toISOString() : undefined,
  from: address(message.envelope?.from?.[0]),
  id: `${folder}:${message.uid}`,
  subject: message.envelope?.subject ?? '',
  unread: !message.flags?.has('\\Seen'),
});

/** The newest messages in a folder that match, newest first; reading them does not mark them read. */
export const searchMailbox = async (client: ImapFlow, search: MailSearch) => {
  const lock = await client.getMailboxLock(search.folder, { readOnly: true });
  try {
    const query = search.query?.trim();
    const uids = await client.search(
      {
        ...(search.unreadOnly && { seen: false }),
        ...(search.since && { since: search.since }),
        ...(query && { or: [{ subject: query }, { from: query }, { body: query }] }),
      },
      { uid: true },
    );
    if (!uids || uids.length === 0) return [];

    const newest = [...uids].sort((a, b) => b - a).slice(0, search.limit);
    const messages = await client.fetchAll(
      newest.join(','),
      { envelope: true, flags: true, uid: true },
      { uid: true },
    );
    return messages
      .sort((a, b) => b.uid - a.uid)
      .map((message) => summarize(search.folder, message));
  } finally {
    lock.release();
  }
};

export interface MailContent {
  attachments: { contentType: string; filename?: string; size: number }[];
  cc: string;
  date?: string;
  from: string;
  /** The message's own Message-ID, for replying in its thread */
  messageId?: string;
  references: string[];
  subject: string;
  text: string;
  to: string;
  truncated: boolean;
}

const addressText = (value: unknown): string => {
  if (!value) return '';
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry: { text?: string }) => entry.text ?? '').join(', ');
};

/** One message, parsed: its text (HTML turned into text), who and when, and its attachments' names. */
export const readMessage = async (
  client: ImapFlow,
  folder: string,
  uid: number,
): Promise<MailContent | undefined> => {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const message = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
    if (!message || !message.source) return undefined;

    const parsed = await simpleParser(message.source, { skipImageLinks: true });
    const text = (parsed.text ?? '').trim();
    const references = Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : [];

    return {
      attachments: parsed.attachments.map((attachment) => ({
        contentType: attachment.contentType,
        filename: attachment.filename,
        size: attachment.size,
      })),
      cc: addressText(parsed.cc),
      date: parsed.date?.toISOString(),
      from: addressText(parsed.from),
      messageId: parsed.messageId,
      references,
      subject: parsed.subject ?? '',
      text: text.slice(0, TEXT_LIMIT),
      to: addressText(parsed.to),
      truncated: text.length > TEXT_LIMIT,
    };
  } finally {
    lock.release();
  }
};
