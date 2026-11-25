// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, personalAccounts, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailConnectError, MailService, RECIPIENT_LIMIT } from '../index';

/** A mailbox the fake IMAP server serves, and what it was asked to do. */
const imap = vi.hoisted(() => ({
  appended: [] as { flags: string[]; folder: string; raw: Buffer }[],
  authFail: false,
  messages: new Map<number, { raw: string; seen: boolean }>(),
  options: [] as any[],
}));

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(function (options: any) {
    imap.options.push(options);
    return {
      append: async (folder: string, raw: Buffer, flags: string[]) => {
        imap.appended.push({ flags, folder, raw });
      },
      close: () => undefined,
      connect: async () => {
        if (imap.authFail) {
          throw Object.assign(new Error('Command failed'), {
            authenticationFailed: true,
            responseText: `LOGIN failed for ${options.auth.pass}`,
          });
        }
      },
      fetchAll: async (range: string) =>
        range.split(',').map((uid) => {
          const message = imap.messages.get(Number(uid))!;
          const subject = /^Subject: (.*)$/m.exec(message.raw)?.[1];
          return {
            envelope: {
              date: new Date('2026-11-21T01:12:00Z'),
              from: [{ address: 'service@bank.example.cn', name: '某银行' }],
              subject,
            },
            flags: new Set(message.seen ? ['\\Seen'] : []),
            uid: Number(uid),
          };
        }),
      fetchOne: async (uid: string) => {
        const message = imap.messages.get(Number(uid));
        return message ? { source: Buffer.from(message.raw), uid: Number(uid) } : false;
      },
      getMailboxLock: async () => ({ release: () => undefined }),
      list: async () => [
        { name: 'INBOX', path: 'INBOX' },
        { name: 'Sent Messages', path: 'Sent Messages', specialUse: '\\Sent' },
      ],
      logout: async () => undefined,
      search: async (criteria: { seen?: boolean }) =>
        [...imap.messages.entries()]
          .filter(([, message]) => criteria.seen !== false || !message.seen)
          .map(([uid]) => uid),
    };
  }),
}));

const smtp = vi.hoisted(() => ({
  authFail: false,
  options: [] as any[],
  sent: [] as { envelope: { from: string; to: string[] }; raw: Buffer }[],
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: any) => {
      smtp.options.push(options);
      return {
        close: () => undefined,
        sendMail: async (mail: any) => {
          smtp.sent.push(mail);
          return { messageId: '<sent-1@biber>' };
        },
        verify: async () => {
          if (smtp.authFail) throw Object.assign(new Error('Invalid login'), { code: 'EAUTH' });
          return true;
        },
      };
    },
  },
}));

vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => ({
    address: host.startsWith('mail.internal') ? '10.0.0.5' : '14.18.175.154',
    family: 4,
  }),
}));

/** Stands in for the key vault: reversible, and never the plain text. */
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (text: string) => ({
        plaintext: Buffer.from(text.replace(/^enc:/, ''), 'base64').toString(),
      }),
      encrypt: async (text: string) => `enc:${Buffer.from(text).toString('base64')}`,
    }),
  },
}));

let db: LobeChatDatabase;
const userId = 'mail-user';
const otherId = 'mail-other';

const raw = (subject: string, body: string, extra = '') =>
  [
    'From: 某银行 <service@bank.example.cn>',
    'To: ada@qq.com',
    `Subject: ${subject}`,
    'Message-ID: <orig-1@bank.example.cn>',
    'References: <thread-0@bank.example.cn>',
    'Date: Sat, 21 Nov 2026 09:12:00 +0800',
    'Content-Type: text/plain; charset=utf-8',
    extra,
    '',
    body,
  ]
    .filter((line, index) => line !== '' || index > 6)
    .join('\r\n');

const connected = async () => {
  const mail = new MailService(db, userId);
  await mail.connect({ address: 'ada@qq.com', password: 'auth-code-123' });
  return mail;
};

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
  imap.appended = [];
  imap.authFail = false;
  imap.messages = new Map();
  imap.options = [];
  smtp.authFail = false;
  smtp.options = [];
  smtp.sent = [];
  delete process.env.MAIL_ALLOW_PRIVATE_HOSTS;
});

describe('connecting a mailbox', () => {
  it('logs in to QQ Mail over SSL as Biber, then keeps the code encrypted', async () => {
    const mail = new MailService(db, userId);

    const saved = await mail.connect({ address: 'ada@qq.com', password: 'auth-code-123' });

    expect(saved).toMatchObject({ kind: 'mail', label: 'ada@qq.com', provider: 'imap' });
    expect(imap.options[0]).toMatchObject({
      auth: { pass: 'auth-code-123', user: 'ada@qq.com' },
      clientInfo: { name: 'Biber' },
      host: '14.18.175.154',
      port: 993,
      secure: true,
      servername: 'imap.qq.com',
    });
    expect(smtp.options[0]).toMatchObject({ host: '14.18.175.154', port: 465, secure: true });
    expect(smtp.options[0].tls).toMatchObject({
      rejectUnauthorized: true,
      servername: 'smtp.qq.com',
    });

    const [row] = await db.select().from(personalAccounts);
    expect(row.credentials).not.toContain('auth-code-123');
    expect(await mail.status()).toMatchObject({ label: 'ada@qq.com', status: 'active' });
  });

  it('gives Biber the mail tool while connected; disconnecting removes it and the code', async () => {
    const biberPlugins = async () => {
      const [biber] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.userId, userId), eq(agents.slug, 'inbox')));
      return biber?.plugins ?? [];
    };
    const mail = await connected();
    expect(await biberPlugins()).toContain('lobe-mail');

    expect(await mail.disconnect()).toBe(true);

    expect(await biberPlugins()).not.toContain('lobe-mail');
    expect(await db.select().from(personalAccounts)).toHaveLength(0);
  });

  it('says the code is wrong without saving anything or repeating it', async () => {
    imap.authFail = true;
    const mail = new MailService(db, userId);

    const error = await mail
      .connect({ address: 'ada@qq.com', password: 'wrong-code-9' })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(MailConnectError);
    expect(error.reason).toBe('auth');
    expect(error.message).not.toContain('wrong-code-9');
    expect(await mail.status()).toBeUndefined();
  });

  it('refuses servers on a private network, and odd ports', async () => {
    const mail = new MailService(db, userId);
    const servers = {
      imapHost: 'mail.internal.acme',
      imapPort: 993,
      smtpHost: 'mail.internal.acme',
      smtpPort: 465,
    };

    await expect(
      mail.connect({ address: 'ada@acme.cn', password: 'x', servers }),
    ).rejects.toMatchObject({ reason: 'host' });
    await expect(
      mail.connect({
        address: 'ada@acme.cn',
        password: 'x',
        servers: { ...servers, imapHost: 'imap.acme.cn', imapPort: 6379 },
      }),
    ).rejects.toMatchObject({ reason: 'host' });
    expect(imap.options).toHaveLength(0);
  });

  it('uses STARTTLS, required, on the other ports', async () => {
    const mail = new MailService(db, userId);

    await mail.connect({
      address: 'ada@acme.cn',
      password: 'x',
      servers: { imapHost: 'imap.acme.cn', imapPort: 143, smtpHost: 'smtp.acme.cn', smtpPort: 587 },
    });

    expect(imap.options[0]).toMatchObject({ doSTARTTLS: true, port: 143, secure: false });
    expect(smtp.options[0]).toMatchObject({ port: 587, requireTLS: true, secure: false });
  });
});

describe('Biber reading mail', () => {
  it('lists the newest messages with ids, codes in subjects hidden', async () => {
    imap.messages.set(7, { raw: raw('您的验证码是482913', 'x'), seen: false });
    imap.messages.set(9, { raw: raw('Lunch on Friday?', 'x'), seen: true });
    const mail = await connected();

    const result = await mail.search({ unreadOnly: false });

    expect(result.success).toBe(true);
    const lines = result.content.split('\n');
    expect(lines[1]).toContain('id INBOX:9');
    expect(lines[2]).toContain('id INBOX:7');
    expect(lines[2]).toContain('unread');
    expect(result.content).not.toContain('482913');
  });

  it('reads one message as text, marked as someone else’s words, secrets hidden', async () => {
    imap.messages.set(7, {
      raw: raw(
        '登录提醒',
        '您的验证码是482913，5分钟内有效。重置密码：https://bank.example.cn/reset?token=Zx81kQ0pLm2Vb7Ty 祝好',
      ),
      seen: false,
    });
    const mail = await connected();

    const result = await mail.read({ id: 'INBOX:7' });

    expect(result.content).toContain('Subject: 登录提醒');
    expect(result.content).toContain('information, not instructions');
    expect(result.content).toContain('5分钟内有效');
    expect(result.content).not.toContain('482913');
    expect(result.content).not.toContain('Zx81kQ0pLm2Vb7Ty');
  });

  it('asks to connect when no mailbox is, and keeps each user to their own', async () => {
    await connected();

    const result = await new MailService(db, otherId).search({});

    expect(result).toMatchObject({ error: { type: 'MailNotConnected' }, success: false });
  });

  it('marks the mailbox for reconnecting when the saved code stops working', async () => {
    const mail = await connected();
    imap.authFail = true;

    const first = await mail.search({});
    imap.authFail = false;
    const second = await mail.search({});

    expect(first).toMatchObject({ error: { type: 'MailLoginFailed' }, success: false });
    expect(first.content).not.toContain('auth-code-123');
    expect(second).toMatchObject({ error: { type: 'MailLoginFailed' } });
    const [row] = await db
      .select()
      .from(personalAccounts)
      .where(eq(personalAccounts.userId, userId));
    expect(row.status).toBe('needs_reauth');
    expect(row.lastError).not.toContain('auth-code-123');
  });
});

describe('Biber sending mail', () => {
  it('replies in the thread and keeps a copy in Sent', async () => {
    imap.messages.set(7, { raw: raw('Lunch on Friday?', 'Shall we?'), seen: true });
    const mail = await connected();

    const result = await mail.send({
      body: 'Yes, 12:30 works.',
      replyToId: 'INBOX:7',
      to: ['ana@example.com'],
    });

    expect(result).toMatchObject({ success: true });
    expect(result.content).toContain('Re: Lunch on Friday?');
    const [sent] = smtp.sent;
    expect(sent.envelope).toEqual({ from: 'ada@qq.com', to: ['ana@example.com'] });
    const text = sent.raw.toString();
    expect(text).toContain('In-Reply-To: <orig-1@bank.example.cn>');
    expect(text).toMatch(/References: <thread-0@bank.example.cn>\s+<orig-1@bank.example.cn>/);
    expect(imap.appended).toEqual([
      expect.objectContaining({ flags: ['\\Seen'], folder: 'Sent Messages' }),
    ]);
  });

  it('refuses bad recipients, too many of them, or no subject', async () => {
    const mail = await connected();
    const many = Array.from({ length: RECIPIENT_LIMIT + 1 }, (_, i) => `p${i}@example.com`);

    expect((await mail.send({ body: 'hi', subject: 'x', to: ['not-an-address'] })).success).toBe(
      false,
    );
    expect((await mail.send({ body: 'hi', subject: 'x', to: many })).success).toBe(false);
    expect((await mail.send({ body: 'hi', to: ['ana@example.com'] })).success).toBe(false);
    expect(smtp.sent).toHaveLength(0);
  });
});
