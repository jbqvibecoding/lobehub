/**
 * The shared Telegram bot, against a running server: updates without the webhook secret are
 * refused, a new user is sent the link that connects their account, they connect it, a message
 * gets the agent's reply, and an action that needs approval is approved with the chat's button.
 *
 *   bunx tsx scripts/biber/smoke/telegram-bot.ts
 *
 * Before running:
 * - store the bot (any token works against the stand-in):
 *     echo '{"botToken":"123:smoke","webhookSecret":"<SMOKE_TELEGRAM_SECRET>"}' |
 *       bunx tsx scripts/biber/ops.ts bot set telegram
 * - start the server with Telegram's API redirected to this script's stand-in (port 4050):
 *     SMOKE_REDIRECT_HOSTS=api.telegram.org=http://127.0.0.1:4050 \
 *     NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs"
 * - point the server's OPENAI_PROXY_URL at this script's fake model (port 4010).
 */
import { SmokeClient, waitFor } from './client';
import { startFakeModel, startFakeTelegramApi } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const WEBHOOK = `${BASE_URL}/api/agent/messenger/webhooks/telegram`;
const SECRET = process.env.SMOKE_TELEGRAM_SECRET!;

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

let updateId = Math.floor(Date.now() / 1000);

/** Posts an update the way Telegram does; `null` leaves the webhook secret out. */
const deliver = async (update: object, secret: string | null = SECRET) => {
  const response = await fetch(WEBHOOK, {
    body: JSON.stringify({ update_id: updateId++, ...update }),
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}),
    },
    method: 'POST',
  });
  return { status: response.status, text: await response.text() };
};

const main = async () => {
  if (!SECRET)
    throw new Error('Set SMOKE_TELEGRAM_SECRET to the webhookSecret the bot was stored with');

  const telegram = await startFakeTelegramApi(Number(process.env.SMOKE_TELEGRAM_API_PORT ?? 4050));
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const userId = 600_000_000 + (Date.now() % 100_000_000);
  const user = { first_name: 'Smoke', id: userId, is_bot: false, username: `smoke${userId}` };
  let messageId = 1;
  const message = (text: string) => ({
    message: {
      chat: { first_name: 'Smoke', id: userId, type: 'private', username: user.username },
      date: Math.floor(Date.now() / 1000),
      from: user,
      message_id: messageId++,
      text,
      ...(text.startsWith('/')
        ? { entities: [{ length: text.split(' ')[0].length, offset: 0, type: 'bot_command' }] }
        : {}),
    },
  });
  const sentText = (pattern: RegExp) =>
    telegram.textsTo(userId).find((sent) => pattern.test(sent.text));

  try {
    await step('an update without the webhook secret is refused', async () => {
      const { status } = await deliver(message('hello'), null);
      if (status !== 401) throw new Error(`HTTP ${status}`);
    });

    const link = await step('a new user is sent the link to connect their account', async () => {
      const { status } = await deliver(message('/start'));
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const sent = await waitFor('the welcome', async () => sentText(/verify-im/), 30_000);
      return new URL(sent.text.match(/https?:\/\/\S+/)![0]);
    });

    const client = new SmokeClient(BASE_URL);
    await client.signUp(`telegram-${Date.now()}@biber.test`, 'Smoke-pass-12345', 'Telegram smoke');
    const { agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: {
        // Runs on the cloud computer, which is what offers the code tool that asks for approval
        agencyConfig: { executionTarget: 'sandbox' },
        model: 'gpt-4o-mini',
        plugins: ['lobe-cloud-sandbox'],
        provider: 'openai',
        systemRole: '',
        title: 'Telegram agent',
      },
    });

    await step('connecting the account confirms in Telegram', async () => {
      await client.mutation('lambda', 'messenger.confirmLink', {
        initialAgentId: agentId,
        randomId: link.searchParams.get('random_id'),
      });
      await waitFor('the confirmation', async () => sentText(/Linked successfully/), 15_000);
    });

    await step('a message gets the agent’s reply in Telegram', async () => {
      await deliver(message('hello there'));
      await waitFor('the reply', async () => sentText(/Hello from the fake model/), 90_000);
    });

    const approve = await step('an action that needs approval shows its buttons', async () => {
      await deliver(message('Please run code that adds one and one.'));
      const request = await waitFor(
        'the approval request',
        async () =>
          telegram
            .textsTo(userId)
            .find((sent) =>
              sent.buttons.some((b) => b.callback_data?.startsWith('messenger:approve:')),
            ),
        90_000,
      );
      return {
        data: request.buttons.find((b) => b.callback_data?.startsWith('messenger:approve:'))!
          .callback_data!,
        messageId: request.messageId!,
      };
    });

    const tap = (id: string) => ({
      callback_query: {
        chat_instance: 'smoke',
        data: approve.data,
        from: user,
        id,
        message: {
          chat: { id: userId, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          message_id: approve.messageId,
          text: 'approval',
        },
      },
    });

    await step('a button tap without the webhook secret is refused', async () => {
      const { status } = await deliver(tap('cb-forged'), null);
      if (status !== 401) throw new Error(`HTTP ${status}`);
    });

    await step('approving with the button resumes the run and the reply arrives', async () => {
      const { status } = await deliver(tap(`cb-${Date.now()}`));
      if (status !== 200) throw new Error(`HTTP ${status}`);
      await waitFor(
        'the tap to be answered',
        async () => telegram.calls.find((call) => call.method === 'answerCallbackQuery'),
        15_000,
      );
      // The fake model answers this once the approved code has run
      await waitFor(
        'the reply after the approved action',
        async () => sentText(/The code ran/),
        90_000,
      );
    });
  } finally {
    telegram.close();
    model.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    if (process.env.SMOKE_VERBOSE) console.log(JSON.stringify(telegram.calls, null, 1));
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
