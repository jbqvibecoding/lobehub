/**
 * Saved logins and Biber's browser, against a running server and a real cloud computer
 * (agent-computer with Chromium, started here) on a small local test shop:
 * - the phone saves a login; the list shows its site and a masked account, never the password;
 * - "sign in to the test shop": Biber opens the page, lists the logins and asks to sign in; the
 *   approval names the site and the account; once approved the shop receives the right user name
 *   and password, typed by the computer;
 * - the same login on another site is refused by the computer, and a forged site by the server;
 * - "Next page" is clicked without asking; "Place order" waits for approval, then the order
 *   arrives; Enter in the order form is held too;
 * - a sign-in that asks for a texted code: the phone is pushed, takes the code in a masked box,
 *   and the shop receives it;
 * - another account can neither see nor use the login;
 * - neither the password nor the code is in any model request, the database or the server log;
 * - deleting the login removes it.
 *
 *   APP_REGION=cn SMOKE_DATABASE_URL=postgres://… SMOKE_MODEL_PROVIDER=deepseek \
 *   SMOKE_MODEL=deepseek-v4-flash bunx tsx scripts/biber/smoke/saved-logins.ts
 *
 * The server needs the fake model (port 4010), EXPO_BASE_URL=http://127.0.0.1:4020 and, on the
 * mainland edition, ALIYUN_GREEN_ENDPOINT=http://127.0.0.1:4090, as for reminders.ts; plus
 * SANDBOX_PROVIDER=openbot, OPENBOT_SUPERVISOR_URL=http://127.0.0.1:4300,
 * OPENBOT_SUPERVISOR_TOKEN=smoke-supervisor, OPENBOT_COMPUTER_TOKEN=smoke-computer,
 * OPENBOT_COMPUTER_EGRESS=all (the shop is on this machine) and SAVED_LOGINS_ALLOW_HTTP=1.
 * SMOKE_DB_CONTAINER names the database's Docker container for the database check, and
 * SMOKE_SERVER_LOG the server's log file for the log check. The cloud computer runs here with
 * Bun and Playwright's Chromium; where its Playwright wants another browser build than the one
 * installed, point PLAYWRIGHT_BROWSERS_PATH at a folder that links that build's name to it.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import {
  type ModelRequest,
  type PushRequest,
  startFakeContentSafety,
  startFakeExpoPush,
  startFakeModel,
  startFakeSupervisor,
  startTestShop,
} from './fake-services';
import { computerIdForUser, startLocalComputer } from './local-computer';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const SUPERVISOR_TOKEN = process.env.SMOKE_SUPERVISOR_TOKEN ?? 'smoke-supervisor';
const COMPUTER_SECRET = process.env.SMOKE_COMPUTER_TOKEN ?? 'smoke-computer';
const COMPUTER_PORT = Number(process.env.SMOKE_COMPUTER_PORT ?? 4100);
const SHOP_PORT = Number(process.env.SMOKE_SHOP_PORT ?? 4120);
const SHOP = `http://127.0.0.1:${SHOP_PORT}`;

const PASSWORD = `Smoke-Login-${randomBytes(6).toString('hex')}`;
const CODE = String(100_000 + (randomBytes(3).readUIntBE(0, 3) % 900_000));
const USERNAME = 'ada@shop.test';

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

interface PendingApproval {
  apiName: string;
  arguments?: string;
  identifier: string;
}

/** Everything the model was sent, as text, to look for what must not reach it. */
const seenByModel = (requests: ModelRequest[]) =>
  requests.flatMap((request) => request.messages.map((message) => JSON.stringify(message.content)));

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const push = await startFakeExpoPush(Number(process.env.SMOKE_PUSH_PORT ?? 4020));
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const shop = await startTestShop(SHOP_PORT, {
    code: CODE,
    password: PASSWORD,
    username: USERNAME,
  });
  const supervisor = await startFakeSupervisor(Number(process.env.SMOKE_SUPERVISOR_PORT ?? 4300), {
    computerUrl: `http://127.0.0.1:${COMPUTER_PORT}`,
    token: SUPERVISOR_TOKEN,
  });
  let computer: Awaited<ReturnType<typeof startLocalComputer>> | undefined;
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();
  const expoToken = `ExponentPushToken[logins-${stamp}]`;

  const history = (topicId: string) =>
    client.query<ChatHistory>('mobile', 'chat.history', { topicId });
  /** Sends a message to Biber and waits until its run is idle with a reply, or waits on the user. */
  const say = async (text: string) => {
    const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', { text });
    const settled = await waitFor(
      `Biber to answer “${text}”`,
      async () => {
        const chat = await history(topicId);
        const waiting = chat.lines.find(
          (line) => line.kind === 'tool' && line.status === 'waiting',
        );
        if (chat.run === 'waiting' && waiting) return { chat, waiting };
        const last = chat.lines.at(-1);
        const replied = last?.kind === 'assistant' && !!last.text && last.text !== '...';
        return chat.run === 'idle' && replied ? { chat, waiting: undefined } : undefined;
      },
      180_000,
    );
    return { ...settled, topicId };
  };
  const replied = (topicId: string, reply: RegExp) =>
    waitFor(
      `a reply matching ${reply}`,
      async () => {
        const { lines, run } = await history(topicId);
        const found = lines.find(
          (line) => line.kind === 'assistant' && reply.test(line.text ?? ''),
        );
        return run === 'idle' && found ? found : undefined;
      },
      180_000,
    ).catch(async (error) => {
      const { lines } = await history(topicId);
      const said = lines.map((line) => `${line.kind}: ${(line.text ?? '').slice(0, 200)}`);
      throw new Error(
        `${error}\nthe chat:\n${said.join('\n')}\nthe tools answered:\n${lastToolResults()}`,
      );
    });
  const approve = (toolMessageId: string) =>
    client.mutation('mobile', 'approval.respond', { decision: 'approved', toolMessageId });
  /** What the tools answered in the latest model request, to tell a refusal from a miss. */
  const lastToolResults = () =>
    (model.requests.at(-1)?.messages ?? [])
      .filter((message) => message.role === 'tool')
      .map(
        (message: any) =>
          `${message.tool_call_id ?? '?'} ${JSON.stringify(message.content).slice(0, 400)}`,
      )
      .join('\n');
  const pendingCall = async (apiName: string) => {
    const pending = await client.query<PendingApproval[]>('mobile', 'approval.listPending', {});
    return pending.find((item) => item.identifier === 'lobe-computer' && item.apiName === apiName);
  };

  try {
    const email = `logins-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Saved logins');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    await client.mutation('mobile', 'pushToken.register', {
      deviceId: `logins-${stamp}`,
      expoToken,
      locale: 'en-US',
      platform: 'ios',
    });
    // Biber's own model has no key locally: run it on the fake model the server points at
    await client.query('lambda', 'agent.getBuiltinAgent', { slug: 'inbox' });
    await db.query(
      `update agents set provider = $1, model = $2 where user_id = $3 and slug = 'inbox'`,
      [
        process.env.SMOKE_MODEL_PROVIDER ?? 'openai',
        process.env.SMOKE_MODEL ?? 'gpt-4o-mini',
        userId,
      ],
    );
    computer = await startLocalComputer({
      computerId: computerIdForUser(userId),
      port: COMPUTER_PORT,
      secret: COMPUTER_SECRET,
    });

    const login = await step('the phone saves a login; the list shows no password', async () => {
      const saved = await client.mutation<{ account: string; id: string; site: string }>(
        'mobile',
        'logins.create',
        { password: PASSWORD, site: `${SHOP}/login`, username: USERNAME },
      );
      const listed = await client.query<unknown[]>('mobile', 'logins.list');
      if (saved.site !== SHOP || saved.account !== 'a•••@shop.test') {
        throw new Error(JSON.stringify(saved));
      }
      if (JSON.stringify(listed).includes(PASSWORD) || JSON.stringify(listed).includes(USERNAME)) {
        throw new Error('the list shows the login');
      }
      const { rows: stored } = await db.query(
        'select credentials from saved_logins where user_id = $1',
        [userId],
      );
      if (stored[0]?.credentials.includes(PASSWORD)) throw new Error('stored in plain text');
      return saved;
    });

    await step(
      'signing in waits for approval naming the site, then the computer types it',
      async () => {
        const { topicId, waiting } = await say(`Sign in to the test shop at ${SHOP}/login`);
        if (!waiting) throw new Error('it signed in without approval');
        const card = await pendingCall('signIn');
        if (!card?.arguments?.includes(SHOP) || !card.arguments.includes('a•••@shop.test')) {
          throw new Error(
            `the approval does not name the site and account: ${JSON.stringify(card)}`,
          );
        }
        if (shop.received.logins.length > 0) throw new Error('typed before approval');

        await approve(waiting.id);
        await replied(topicId, /^Signed in\.$/);
        if (
          JSON.stringify(shop.received.logins) !==
          JSON.stringify([{ password: PASSWORD, username: USERNAME }])
        ) {
          throw new Error(
            `the shop got ${shop.received.logins.length} logins; the tools answered:\n${lastToolResults()}`,
          );
        }
      },
    );

    await step('the login is refused on another site, and with a forged site', async () => {
      const before = shop.received.logins.length;
      const { topicId, waiting } = await say(
        `Sign in to the test shop at http://localhost:${SHOP_PORT}/login`,
      );
      if (!waiting) throw new Error('it signed in without approval');
      await approve(waiting.id);
      await replied(topicId, /could not sign in/);
      if (shop.received.logins.length !== before) throw new Error('typed on another site');

      const forged = await client.mutation<{ content: string; success: boolean }>(
        'lambda',
        'computerTools.signIn',
        { account: login.account, loginId: login.id, site: `http://localhost:${SHOP_PORT}` },
      );
      if (forged.success || !/not that saved login/.test(forged.content)) {
        throw new Error(JSON.stringify(forged));
      }
    });

    await step('Next page is clicked without asking', async () => {
      const { topicId, waiting } = await say(`Open the next page at ${SHOP}/checkout`);
      if (waiting) throw new Error('it asked to click Next page');
      await replied(topicId, /^Moved on\.$/);
    });

    await step('Place order waits for approval, then the order arrives', async () => {
      const { topicId, waiting } = await say(`Place the order at ${SHOP}/checkout`);
      if (!waiting) throw new Error('it ordered without approval');
      const card = await pendingCall('clickWithApproval');
      if (!card?.arguments?.includes('Place order') || !card.arguments.includes(SHOP)) {
        throw new Error(`the approval does not name the button and site: ${JSON.stringify(card)}`);
      }
      if (shop.received.orders.length > 0) throw new Error('ordered before approval');
      await approve(waiting.id);
      await replied(topicId, /^Ordered\.$/);
      if (shop.received.orders.length !== 1)
        throw new Error(`${shop.received.orders.length} orders`);
    });

    await step('Enter in the order form is held as well', async () => {
      const { topicId } = await say(`Press enter in the order note at ${SHOP}/checkout`);
      await replied(topicId, /needs your approval/);
      if (shop.received.orders.length !== 1) throw new Error('Enter placed an order');
    });

    await step(
      'a texted code is asked for on the phone and typed straight into the page',
      async () => {
        const pushesBefore = push.sent.length;
        const { topicId, waiting } = await say(
          `Sign in to the test shop with a code at ${SHOP}/login-code`,
        );
        if (!waiting) throw new Error('it signed in without approval');
        await approve(waiting.id);

        const asked = await waitFor(
          'the phone to be asked for the code',
          async () => {
            const view = await client.query<{ control?: { secretWanted?: string } }>(
              'mobile',
              'computer.view',
              { withScreen: false },
            );
            return view.control?.secretWanted;
          },
          90_000,
        );
        if (!/code/.test(asked)) throw new Error(`asked for ${asked}`);
        const pushed = push.sent
          .slice(pushesBefore)
          .find((sent: PushRequest) => sent.to === expoToken && sent.data?.kind === 'computer');
        if (!pushed || pushed.body.includes('code texted')) {
          throw new Error(`push: ${JSON.stringify(pushed)}`);
        }

        await client.mutation('mobile', 'computer.supplySecret', { text: CODE });
        await replied(topicId, /^Signed in with the code\.$/);
        if (!shop.received.codes.includes(CODE)) {
          throw new Error(`the shop got ${JSON.stringify(shop.received.codes.length)} codes`);
        }
      },
    );

    await step('another account can neither see nor use the login', async () => {
      const stranger = new SmokeClient(BASE_URL);
      await stranger.signUp(`logins-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
      if ((await stranger.query<unknown[]>('mobile', 'logins.list')).length > 0) {
        throw new Error('a stranger lists it');
      }
      const used = await stranger.mutation<{ content: string; success: boolean }>(
        'lambda',
        'computerTools.signIn',
        { account: login.account, loginId: login.id, site: login.site },
      );
      if (used.success || !/No such saved login/.test(used.content))
        throw new Error(JSON.stringify(used));
    });

    await step(
      'the password and the code never reached the model, the database or the log',
      async () => {
        const leaked = seenByModel(model.requests).find(
          (content) => content.includes(PASSWORD) || content.includes(CODE),
        );
        if (leaked) throw new Error(`the model saw it: ${leaked.slice(0, 300)}`);
        if (model.requests.length === 0) throw new Error('the model was never asked anything');

        const container = process.env.SMOKE_DB_CONTAINER;
        if (container) {
          const database = new URL(DATABASE_URL).pathname.slice(1);
          const dump = execFileSync(
            'docker',
            ['exec', container, 'pg_dump', '-U', 'postgres', database],
            {
              maxBuffer: 1024 * 1024 * 1024,
            },
          ).toString();
          if (dump.includes(PASSWORD) || dump.includes(CODE))
            throw new Error('found in the database');
        } else {
          console.log('  (no SMOKE_DB_CONTAINER: the database dump was not checked)');
        }
        const logFile = process.env.SMOKE_SERVER_LOG;
        if (logFile) {
          const log = await readFile(logFile, 'utf8');
          if (log.includes(PASSWORD) || log.includes(CODE))
            throw new Error('found in the server log');
        }
        if (computer!.output().includes(PASSWORD)) throw new Error('found in the computer’s log');
      },
    );

    await step('deleting the login removes it', async () => {
      await client.mutation('mobile', 'logins.delete', { id: login.id });
      const { rows: left } = await db.query(
        'select count(*)::int as n from saved_logins where user_id = $1',
        [userId],
      );
      if (left[0].n !== 0) throw new Error(`${left[0].n} left`);
    });

    if (contentSafety.checks.length === 0) console.log('(no content safety checks were made)');
  } finally {
    await computer?.stop();
    model.close();
    push.close();
    contentSafety.close();
    shop.close();
    supervisor.close();
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
