import { isIP } from 'node:net';

import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';

import { resolveMailHost, SMTP_PORTS } from './host';
import type { MailLogin } from './imap';

const TIMEOUT_MS = 20_000;

/**
 * A transport to the user's SMTP server: SSL on 465, STARTTLS required on the other ports, so the
 * password never crosses in clear text.
 */
const transportFor = async ({ host, password, port, user }: MailLogin) => {
  const target = await resolveMailHost(host, port, SMTP_PORTS);
  return nodemailer.createTransport({
    auth: { pass: password, user },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    host: target.address,
    port,
    requireTLS: port !== 465,
    secure: port === 465,
    socketTimeout: TIMEOUT_MS * 3,
    tls: {
      rejectUnauthorized: !target.trustSelfSigned,
      ...(!isIP(target.servername) && { servername: target.servername }),
    },
  });
};

/** Logs in to the SMTP server without sending anything. */
export const verifySmtp = async (login: MailLogin) => {
  const transport = await transportFor(login);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
};

export interface OutgoingMail {
  cc?: string[];
  from: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  text: string;
  to: string[];
}

/** Sends a plain-text mail and gives back the message as sent, for the Sent folder. */
export const sendMail = async (login: MailLogin, mail: OutgoingMail) => {
  const raw = await new MailComposer({
    cc: mail.cc,
    from: mail.from,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    subject: mail.subject,
    text: mail.text,
    to: mail.to,
  })
    .compile()
    .build();

  const transport = await transportFor(login);
  try {
    const info = await transport.sendMail({
      envelope: { from: mail.from, to: [...mail.to, ...(mail.cc ?? [])] },
      raw,
    });
    return { messageId: info.messageId, raw };
  } finally {
    transport.close();
  }
};
