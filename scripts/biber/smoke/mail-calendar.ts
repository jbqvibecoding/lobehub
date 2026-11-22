/**
 * The user's mailbox and Feishu calendar in the mainland edition, against a running server,
 * through the phone's routes and the Feishu callback:
 * - the phone connects a mailbox: a wrong authorization code is refused, the right one connects;
 * - a mail with a verification code and a password-reset link arrives; asked for the latest mail,
 *   Biber reads it, and neither the code nor the link reaches the model;
 * - asked to reply, Biber waits for approval; once approved, the sender gets the reply in the same
 *   thread (`In-Reply-To`);
 * - the Feishu calendar connects: a made-up state is refused, the real one connects once;
 * - "am I free tomorrow afternoon" lists the time around the meeting already there;
 * - "a meeting tomorrow at 3" waits for approval, then reaches Feishu at 15:00 China time;
 * - another account sees neither the mailbox nor the calendar, and cannot read the mail;
 * - disconnecting the mailbox deletes its saved login.
 *
 *   APP_REGION=cn SMOKE_DATABASE_URL=postgres://… SMOKE_MODEL_PROVIDER=deepseek \
 *   SMOKE_MODEL=deepseek-v4-flash bunx tsx scripts/biber/smoke/mail-calendar.ts
 *
 * Before running:
 * - start GreenMail, a test mail server, with two mailboxes and SSL on 993 and 465:
 *     docker run -d --name biber-greenmail -p 127.0.0.1:993:3993 -p 127.0.0.1:465:3465 \
 *       -p 127.0.0.1:3025:3025 -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all
 *       -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users.login=email
 *       -Dgreenmail.users=ada:right-code@mail.test,friend:friend-code@mail.test' \
 *       mirror.gcr.io/greenmail/standalone:2.1.3
 * - store a Feishu app, whose credentials the calendar authorization uses:
 *     echo '{"appSecret":"smoke","verificationToken":"smoke"}' |
 *       bunx tsx scripts/biber/ops.ts bot set feishu --application-id cli_smoke_feishu
 * - start the mainland server as for reminders.ts, plus MAIL_ALLOW_PRIVATE_HOSTS=1 (GreenMail is on
 *   this machine) and Feishu's API redirected to this script's stand-in (port 4080):
 *     SMOKE_REDIRECT_HOSTS=open.feishu.cn=http://127.0.0.1:4080 \
 *     NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs"
 */
import { randomBytes } from 'node:crypto';

import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import {
  type ModelRequest,
  startFakeContentSafety,
  startFakeFeishuApi,
  startFakeModel,
  tomorrowInChina,
} from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const MAIL_HOST = process.env.SMOKE_MAIL_HOST ?? '127.0.0.1';
const MAILBOX = { address: 'ada@mail.test', code: 'right-code' };
const FRIEND = { address: 'friend@mail.test', code: 'friend-code' };
const CODE = '482913';
const RESET_TOKEN = 'Zk3pQ9vR2mT7wX4yB8nL';

const steps: { name: string; ok: boolean }[] = [];
const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    const value = await run();
    steps.push({ name, ok: true });
    console.log(`✓ ${name}`);
    return value;
  } catch (error) {
    steps.push({ name, ok: false });
    console.log(`✗ ${name}: ${error}`);
    throw error;
  }
};

interface ChatHistory {
  lines: { id: string; kind: string; status?: string; text?: string }[];
  run: 'idle' | 'running' | 'waiting';
}

interface Accounts {
  calendar: { connected: boolean; label?: string };
  edition: 'cn';
  mail: { connected: boolean; label?: string };
}

/** Everything the model was sent, as text, to look for what must not reach it. */
const seenByModel = (requests: ModelRequest[]) =>
  requests.flatMap((request) => request.messages.map((message) => JSON.stringify(message.content)));

/** GreenMail's mailbox of `who`, over IMAPS with its self-signed certificate. */
const openMailbox = async (who: { address: string; code: string }) => {
  const client = new ImapFlow({
    auth: { pass: who.code, user: who.address },
    host: MAIL_HOST,
    logger: false,
    port: 993,
    secure: true,
    tls: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
};

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const feishu = await startFakeFeishuApi(Number(process.env.SMOKE_FEISHU_PORT ?? 4080));
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  const history = (topicId: string) =>
    client.query<ChatHistory>('mobile', 'chat.history', { topicId });
  /** Sends a message in a chat with Biber and waits until the run is idle or waiting. */
  const say = async (text: string, topicId?: string) => {
    const sent = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
      text,
      ...(topicId && { topicId }),
    });
    const settled = await waitFor(
      `Biber to answer “${text}”`,
      async () => {
        const chat = await history(sent.topicId);
        const waiting = chat.lines.find(
          (line) => line.kind === 'tool' && line.status === 'waiting',
        );
        if (chat.run === 'waiting' && waiting) return { chat, waiting };
        // The reply starts as a "..." placeholder before the run picks it up
        const last = chat.lines.at(-1);
        const replied = last?.kind === 'assistant' && !!last.text && last.text !== '...';
        return chat.run === 'idle' && replied ? { chat, waiting: undefined } : undefined;
      },
      120_000,
    );
    return { ...settled, topicId: sent.topicId };
  };
  /** Approves the waiting call and waits for the reply after it. */
  const approve = async (topicId: string, toolMessageId: string, reply: RegExp) => {
    await client.mutation('mobile', 'approval.respond', { decision: 'approved', toolMessageId });
    await waitFor(
      `a reply matching ${reply}`,
      async () => {
        const { lines, run } = await history(topicId);
        return run === 'idle' && lines.some((line) => reply.test(line.text ?? ''))
          ? true
          : undefined;
      },
      120_000,
    );
  };
  /** The tool result the model was given after calling `tool`, from the latest such request. */
  const toolResult = (pattern: RegExp) =>
    model.requests
      .flatMap((request) => request.messages)
      .filter((message) => message.role === 'tool')
      .map((message) => JSON.stringify(message.content))
      .findLast((content) => pattern.test(content));

  try {
    const email = `mail-calendar-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Mail and calendar');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    // Biber's own model has no key locally: run it on the fake model the server points at
    await client.query('lambda', 'agent.getBuiltinAgent', { slug: 'inbox' });
    await db.query(
      `update agents set provider = $1, model = $2 where user_id = $3 and slug = 'inbox'`,
      [
        process.env.SMOKE_MODEL_PROVIDER ?? 'deepseek',
        process.env.SMOKE_MODEL ?? 'deepseek-v4-flash',
        userId,
      ],
    );

    await step('the phone offers a mailbox and the Feishu calendar', async () => {
      const accounts = await client.query<Accounts>('mobile', 'accounts.list');
      if (accounts.edition !== 'cn' || accounts.mail.connected || accounts.calendar.connected) {
        throw new Error(JSON.stringify(accounts));
      }
    });

    await step('a wrong authorization code is refused, the right one connects', async () => {
      const servers = { imapHost: MAIL_HOST, imapPort: 993, smtpHost: MAIL_HOST, smtpPort: 465 };
      const refused = await client
        .mutation('mobile', 'accounts.connectMail', {
          address: MAILBOX.address,
          password: 'not-the-code',
          servers,
        })
        .then(() => 'connected')
        .catch((error: unknown) => String(error));
      if (!refused.includes('MAIL_AUTH')) throw new Error(`expected MAIL_AUTH, got ${refused}`);

      const { label } = await client.mutation<{ label: string }>('mobile', 'accounts.connectMail', {
        address: MAILBOX.address,
        password: MAILBOX.code,
        servers,
      });
      const accounts = await client.query<Accounts>('mobile', 'accounts.list');
      if (label !== MAILBOX.address || accounts.mail.label !== MAILBOX.address) {
        throw new Error(JSON.stringify(accounts));
      }
      const { rows: saved } = await db.query(
        `select credentials::text as credentials from personal_accounts where user_id = $1 and kind = 'mail'`,
        [userId],
      );
      if (saved.length !== 1 || saved[0].credentials.includes(MAILBOX.code)) {
        throw new Error('the authorization code is not saved encrypted');
      }
    });

    const originalId = `<smoke-${stamp}@mail.test>`;
    const read = await step(
      'Biber reads the latest mail, without its verification code or reset link',
      async () => {
        await createTransport({ host: MAIL_HOST, port: 3025, secure: false }).sendMail({
          from: `Friend <${FRIEND.address}>`,
          messageId: originalId,
          subject: 'Your account',
          text: [
            `您的验证码是 ${CODE}，5 分钟内有效。`,
            `Reset your password: https://accounts.example.com/reset-password?token=${RESET_TOKEN}`,
            'See you at the design review tomorrow.',
          ].join('\n'),
          to: MAILBOX.address,
        });

        const before = model.requests.length;
        const { chat, topicId } = await say('看看最新的邮件');
        const mail = toolResult(/From: /);
        if (!mail?.includes('Your account') || !mail.includes('design review')) {
          const seen = model.requests
            .slice(before)
            .map((request) => `${request.path} [${request.tools.join(', ')}]`);
          throw new Error(
            `the model did not get the mail: ${mail ?? 'nothing'}; it saw:\n${seen.join('\n')}\n${JSON.stringify(chat.lines).slice(0, 1500)}`,
          );
        }
        if (!mail.includes('[hidden]')) throw new Error(`nothing was hidden: ${mail}`);
        const leaked = seenByModel(model.requests.slice(before)).find(
          (content) => content.includes(CODE) || content.includes(RESET_TOKEN),
        );
        if (leaked) throw new Error(`the model saw the secret: ${leaked.slice(0, 300)}`);
        const { rows: stored } = await db.query(
          `select count(*)::int as n from messages where user_id = $1 and (content like $2 or content like $3)`,
          [userId, `%${CODE}%`, `%${RESET_TOKEN}%`],
        );
        if (stored[0].n !== 0) throw new Error('the secret is stored in the chat');
        if (!chat.lines.some((line) => /latest mail/.test(line.text ?? ''))) {
          throw new Error(JSON.stringify(chat.lines));
        }
        return { topicId };
      },
    );

    await step(
      'a reply waits for approval, then reaches the sender in the same thread',
      async () => {
        const { topicId, waiting } = await say('回复这封邮件，说收到了', read.topicId);
        if (!waiting) throw new Error('the reply went out without approval');
        const friend = await openMailbox(FRIEND);
        const inbox = async () => {
          const status = await friend.status('INBOX', { messages: true });
          return status ? (status.messages ?? 0) : 0;
        };
        try {
          const before = await inbox();
          await approve(topicId, waiting.id, /Replied/);

          const reply = await waitFor(
            'the reply in the friend’s mailbox',
            async () => {
              const lock = await friend.getMailboxLock('INBOX');
              try {
                const count = await inbox();
                if (count <= before) return undefined;
                const message = await friend.fetchOne(String(count), {
                  envelope: true,
                  headers: ['in-reply-to', 'references'],
                });
                return message || undefined;
              } finally {
                lock.release();
              }
            },
            30_000,
          );
          const headers = reply.headers?.toString() ?? '';
          if (reply.envelope?.subject !== 'Re: Your account' || !headers.includes(originalId)) {
            throw new Error(`${reply.envelope?.subject}\n${headers}`);
          }
          if (reply.envelope?.from?.[0]?.address !== MAILBOX.address) {
            throw new Error(`sent as ${JSON.stringify(reply.envelope?.from)}`);
          }
        } finally {
          await friend.logout();
        }
      },
    );

    await step('the Feishu calendar connects with its state, once', async () => {
      const { url } = await client.mutation<{ url: string }>(
        'mobile',
        'accounts.feishuCalendarAuthUrl',
      );
      const page = new URL(url);
      const state = page.searchParams.get('state') ?? '';
      if (
        page.host !== 'accounts.feishu.cn' ||
        !page.searchParams.get('scope')?.includes('calendar:calendar') ||
        !page.searchParams.get('redirect_uri')?.endsWith('/api/feishu/calendar/callback')
      ) {
        throw new Error(url);
      }
      const callback = (withState: string) =>
        fetch(
          `${BASE_URL}/api/feishu/calendar/callback?code=smoke-code&state=${encodeURIComponent(withState)}`,
        );

      const madeUp = await callback(randomBytes(24).toString('hex'));
      if (madeUp.status !== 400) throw new Error(`a made-up state got ${madeUp.status}`);

      const real = await callback(state);
      const text = await real.text();
      if (real.status !== 200 || !text.includes('已连接飞书日历')) {
        throw new Error(`${real.status} ${text.slice(0, 300)}`);
      }
      const again = await callback(state);
      if (again.status !== 400) throw new Error(`a used state got ${again.status}`);

      const accounts = await client.query<Accounts>('mobile', 'accounts.list');
      if (!accounts.calendar.connected || accounts.calendar.label !== 'Ada Feishu') {
        throw new Error(JSON.stringify(accounts));
      }
      if (feishu.tokenRequests[0]?.client_id !== 'cli_smoke_feishu') {
        throw new Error(`asked for a token as ${feishu.tokenRequests[0]?.client_id}`);
      }
    });

    await step('“free tomorrow afternoon” lists the time around the meeting', async () => {
      await say('明天下午有空吗？');
      const free = toolResult(/Free for at least/);
      if (!free || !/13:00.14:00/.test(free) || !/15:00.18:00/.test(free)) {
        throw new Error(`free time: ${free ?? 'none'}`);
      }
      if (!free.includes('Asia/Shanghai')) throw new Error(`not in China time: ${free}`);
    });

    await step(
      'a new meeting waits for approval, then reaches Feishu at 15:00 China time',
      async () => {
        const { topicId, waiting } = await say('明天下午三点建个会');
        if (!waiting) throw new Error('the event was created without approval');
        if (feishu.created.length > 0) throw new Error('Feishu got the event before approval');
        await approve(topicId, waiting.id, /on your calendar/);

        const event = feishu.created[0]?.body;
        const start = Math.floor(new Date(tomorrowInChina(15)).getTime() / 1000);
        if (
          event?.summary !== 'Project sync' ||
          event.start_time?.timestamp !== String(start) ||
          event.end_time?.timestamp !== String(start + 3600) ||
          event.start_time?.timezone !== 'Asia/Shanghai' ||
          feishu.created[0].calendarId !== 'cal_ada'
        ) {
          throw new Error(JSON.stringify(feishu.created));
        }
      },
    );

    await step('another account sees neither account and cannot read the mail', async () => {
      const stranger = new SmokeClient(BASE_URL);
      await stranger.signUp(`mail-calendar-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
      const theirs = await stranger.query<Accounts>('mobile', 'accounts.list');
      if (theirs.mail.connected || theirs.calendar.connected)
        throw new Error(JSON.stringify(theirs));
      const searched = await stranger.query<{ content: string; success: boolean }>(
        'lambda',
        'mail.search',
        {},
      );
      if (searched.success || searched.content.includes('Your account')) {
        throw new Error(JSON.stringify(searched));
      }
    });

    await step('disconnecting the mailbox deletes its saved login', async () => {
      await client.mutation('mobile', 'accounts.disconnectMail');
      const { rows: left } = await db.query(
        `select count(*)::int as n from personal_accounts where user_id = $1 and kind = 'mail'`,
        [userId],
      );
      const accounts = await client.query<Accounts>('mobile', 'accounts.list');
      if (left[0].n !== 0 || accounts.mail.connected) throw new Error(JSON.stringify(accounts));
    });

    if (contentSafety.checks.length === 0) console.log('(no content safety checks were made)');
  } finally {
    model.close();
    contentSafety.close();
    feishu.close();
    await db.end();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
