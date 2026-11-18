/**
 * The cloud computer page, against a running server, through the routes the web app and the phone
 * call: a new account's computer is off and looking at it does not start it; once started, its
 * screen shows; a person cannot click before taking over; taking over raises a request in the
 * person's name and takes it; clicks and text reach the browser; handing back returns it to Biber;
 * another account sees only its own computer.
 *
 *   bunx tsx scripts/biber/smoke/computer.ts
 *
 * The server needs SANDBOX_PROVIDER=openbot, OPENBOT_SUPERVISOR_URL=http://127.0.0.1:4300,
 * OPENBOT_SUPERVISOR_TOKEN=smoke-supervisor and OPENBOT_COMPUTER_TOKEN=smoke-computer (or the
 * SMOKE_OPENBOT_* values below), which point it at the OpenBot stand-in this script starts.
 */
import { sha256 } from 'js-sha256';

import { SmokeClient } from './client';
import { startFakeOpenBot } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';

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

interface View {
  control?: { helpRequested: boolean; holder: 'bot' | 'human'; reason?: string };
  screen?: { base64: string; height: number; url: string; width: number };
  status: 'off' | 'running' | 'unavailable';
}

const computerIdOf = (userId: string) => `u-${sha256(userId).slice(0, 40)}`;

const main = async () => {
  const openbot = await startFakeOpenBot({
    computerPort: Number(process.env.SMOKE_OPENBOT_COMPUTER_PORT ?? 4310),
    computerSecret: process.env.SMOKE_OPENBOT_COMPUTER_TOKEN ?? 'smoke-computer',
    supervisorPort: Number(process.env.SMOKE_OPENBOT_SUPERVISOR_PORT ?? 4300),
    supervisorToken: process.env.SMOKE_OPENBOT_SUPERVISOR_TOKEN ?? 'smoke-supervisor',
  });
  const client = new SmokeClient(BASE_URL);
  const view = () => client.query<View>('lambda', 'computer.view', { withScreen: true });
  const input = (action: Record<string, unknown>) =>
    client.mutation('lambda', 'computer.input', { action });

  try {
    const { user } = await client.signUp(
      `computer-${Date.now()}@biber.test`,
      'Smoke-pass-12345',
      'Computer',
    );
    const botId = computerIdOf(user.id);

    await step("a new account's computer is off, and looking at it does not start it", async () => {
      const seen = await view();
      if (seen.status !== 'off') throw new Error(JSON.stringify(seen));
      if (openbot.ensured.length) throw new Error(`started ${openbot.ensured}`);
    });

    await step('starting it shows the screen and who holds it', async () => {
      await client.mutation('lambda', 'computer.start');
      if (!openbot.ensured.includes(botId)) throw new Error('the supervisor was not asked');
      const seen = await view();
      if (seen.status !== 'running' || seen.control?.holder !== 'bot' || !seen.screen?.base64) {
        throw new Error(JSON.stringify({ ...seen, screen: !!seen.screen }));
      }
    });

    await step('a click before taking over is refused', async () => {
      const refused = await input({ kind: 'click', x: 10, y: 10 }).then(
        () => false,
        (error) => /take control first/i.test(String(error)),
      );
      if (!refused) throw new Error('the click went through');
      if (openbot.humanInputs.length) throw new Error('the computer received it');
    });

    await step("Biber's request for help shows with its reason", async () => {
      openbot.askForHelp(botId, 'Solve the captcha on the login page');
      const seen = await view();
      if (!seen.control?.helpRequested || !/captcha/.test(seen.control.reason ?? '')) {
        throw new Error(JSON.stringify(seen.control));
      }
    });

    await step('taking over answers that request and gives the person the wheel', async () => {
      await client.mutation('lambda', 'computer.takeOver');
      const state = openbot.control.get(botId);
      if (state?.holder !== 'human' || state.request?.source !== 'model') {
        throw new Error(JSON.stringify(state));
      }
    });

    await step('clicks, text and keys reach the browser', async () => {
      await input({ kind: 'click', x: 640, y: 360 });
      await input({ kind: 'type', text: 'hunter2' });
      await input({ key: 'Enter', kind: 'key' });
      const got = openbot.humanInputs.map(({ action, body }) => [action, body]);
      const want = [
        ['click', { x: 640, y: 360 }],
        ['type', { text: 'hunter2' }],
        ['key', { key: 'Enter' }],
      ];
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(JSON.stringify(got));
    });

    await step('handing back returns it to Biber', async () => {
      await client.mutation('lambda', 'computer.handBack');
      if ((await view()).control?.holder !== 'bot') throw new Error('still held');
    });

    await step('taking over unasked raises a request in the person’s name', async () => {
      await client.mutation('lambda', 'computer.takeOver');
      const state = openbot.control.get(botId);
      if (state?.holder !== 'human' || state.request?.source !== 'manual') {
        throw new Error(JSON.stringify(state));
      }
      await client.mutation('lambda', 'computer.handBack');
    });

    await step('another account sees only its own computer', async () => {
      const other = new SmokeClient(BASE_URL);
      await other.signUp(`computer-other-${Date.now()}@biber.test`, 'Smoke-pass-12345', 'Other');
      const seen = await other.query<View>('lambda', 'computer.view', { withScreen: true });
      if (seen.status !== 'off') throw new Error(JSON.stringify(seen));
      const refused = await other.mutation('lambda', 'computer.takeOver').then(
        () => false,
        () => true,
      );
      if (!refused) throw new Error('took over a computer that is not running');
      if (openbot.control.get(botId)?.holder !== 'bot') throw new Error('touched the first one');
    });
  } finally {
    openbot.close();
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
