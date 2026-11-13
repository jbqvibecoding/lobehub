/**
 * The shared iMessage line (through Linq), against a running server: a delivery with a bad
 * signature is refused, a group chat is ignored, a new number is sent the link that connects
 * their account, they connect it and are told so, and a message gets the agent's reply. Every
 * delivery is signed as Linq signs it (Standard Webhooks).
 *
 *   bunx tsx scripts/biber/smoke/imessage-bot.ts
 *
 * Before running:
 * - store the line with a Standard Webhooks secret (`whsec_` and base64):
 *     echo '{"apiKey":"smoke","signingSecret":"<SMOKE_LINQ_SECRET>"}' |
 *       bunx tsx scripts/biber/ops.ts bot set imessage --application-id +15550001111
 * - start the server with Linq's API redirected to this script's stand-in (port 4060):
 *     SMOKE_REDIRECT_HOSTS=api.linqapp.com=http://127.0.0.1:4060 \
 *     NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs"
 * - point the server's OPENAI_PROXY_URL at this script's fake model (port 4010).
 */
import { randomUUID } from 'node:crypto';

import { Webhook } from 'standardwebhooks';

import { SmokeClient, waitFor } from './client';
import { startFakeLinqApi, startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const WEBHOOK = `${BASE_URL}/api/agent/messenger/webhooks/imessage`;
const SECRET = process.env.SMOKE_LINQ_SECRET!;

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

/** Posts an event the way Linq does, signed with `secret`. */
const deliver = async (event: object, secret = SECRET) => {
  const body = JSON.stringify(event);
  const id = `msg_${randomUUID()}`;
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(id, timestamp, body);
  const response = await fetch(WEBHOOK, {
    body,
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-signature': signature,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    },
    method: 'POST',
  });
  return { status: response.status, text: await response.text() };
};

const main = async () => {
  if (!SECRET)
    throw new Error('Set SMOKE_LINQ_SECRET to the signingSecret the line was stored with');

  const linq = await startFakeLinqApi(Number(process.env.SMOKE_LINQ_API_PORT ?? 4060));
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const stamp = Date.now() % 10_000_000;
  const phone = `+1555${String(stamp).padStart(7, '0')}`;
  const chatId = `chat-${stamp}`;
  // Linq names each participant with an id of its own; the phone number is the handle
  const sender = { handle: phone, id: `handle-${randomUUID()}`, is_me: false, service: 'iMessage' };
  const received = (text: string, chat = { id: chatId, is_group: false }) => ({
    api_version: 'v3',
    created_at: new Date().toISOString(),
    data: {
      chat,
      direction: 'inbound',
      id: `in-${randomUUID()}`,
      parts: [{ type: 'text', value: text }],
      sender_handle: sender,
      sent_at: new Date().toISOString(),
    },
    event_id: randomUUID(),
    event_type: 'message.received',
  });
  const sentText = (pattern: RegExp) => linq.sent.find((message) => pattern.test(message.text));

  try {
    await step('a delivery with a bad signature is refused', async () => {
      const forged = `whsec_${Buffer.from('not-the-secret-not-the-secret!!').toString('base64')}`;
      const { status } = await deliver(received('hello'), forged);
      if (status !== 401) throw new Error(`HTTP ${status}`);
    });

    await step('a group chat message is acknowledged and ignored', async () => {
      const { status } = await deliver(
        received('hello all', { id: `group-${stamp}`, is_group: true }),
      );
      if (status !== 200) throw new Error(`HTTP ${status}`);
    });

    const link = await step('a new number is sent the link to connect their account', async () => {
      const { status } = await deliver(received('hi'));
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const message = await waitFor('the welcome', async () => sentText(/verify-im/), 30_000);
      if (message.chatId !== chatId) throw new Error(`sent to ${message.chatId}, not ${chatId}`);
      return new URL(message.text.match(/https?:\/\/\S+/)![0]);
    });
    if (linq.sent.some((message) => message.chatId === `group-${stamp}`)) {
      throw new Error('the bot answered in the group chat');
    }

    const client = new SmokeClient(BASE_URL);
    await client.signUp(`imessage-${Date.now()}@biber.test`, 'Smoke-pass-12345', 'iMessage smoke');
    const { agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: { model: 'gpt-4o-mini', provider: 'openai', systemRole: '', title: 'iMessage agent' },
    });

    await step('connecting the account confirms by iMessage', async () => {
      await client.mutation('lambda', 'messenger.confirmLink', {
        initialAgentId: agentId,
        randomId: link.searchParams.get('random_id'),
      });
      await waitFor('the confirmation', async () => sentText(/^Linked\./), 15_000);
    });

    await step('a message gets the agent’s reply by iMessage', async () => {
      await deliver(received('hello there'));
      await waitFor('the reply', async () => sentText(/Hello from the fake model/), 90_000);
    });
  } finally {
    linq.close();
    model.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    if (process.env.SMOKE_VERBOSE) console.log(JSON.stringify(linq.sent, null, 1));
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
