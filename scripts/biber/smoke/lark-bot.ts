/**
 * The Lark store app, against a running server, with deliveries encrypted and signed as Lark does
 * when an encrypt key is set: the setup challenge is answered, a delivery with the wrong token is
 * refused, a company installs the app, one of its people is sent the link that connects their
 * account, they connect it, and a message gets the agent's reply, all sent with that company's
 * own tenant token.
 *
 *   bunx tsx scripts/biber/smoke/lark-bot.ts
 *
 * Before running:
 * - store the app:
 *     echo '{"appSecret":"smoke","verificationToken":"<SMOKE_LARK_TOKEN>","encryptKey":"<SMOKE_LARK_ENCRYPT_KEY>"}' |
 *       bunx tsx scripts/biber/ops.ts bot set lark --application-id <SMOKE_LARK_APP_ID>
 * - start the server with Lark's API redirected to this script's stand-in (port 4070):
 *     SMOKE_REDIRECT_HOSTS=open.larksuite.com=http://127.0.0.1:4070 \
 *     NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs"
 * - point the server's OPENAI_PROXY_URL at this script's fake model (port 4010).
 */
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

import { SmokeClient, waitFor } from './client';
import { startFakeLarkApi, startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const PLATFORM = process.env.SMOKE_LARK_PLATFORM ?? 'lark';
const WEBHOOK = `${BASE_URL}/api/agent/messenger/webhooks/${PLATFORM}`;
const app = {
  appId: process.env.SMOKE_LARK_APP_ID ?? 'cli_smoke',
  encryptKey: process.env.SMOKE_LARK_ENCRYPT_KEY!,
  token: process.env.SMOKE_LARK_TOKEN!,
};

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

/** Lark's event encryption: AES-256-CBC with sha256(encrypt key), the IV in front, base64. */
const encrypt = (plain: string) => {
  const iv = randomBytes(16);
  const key = createHash('sha256').update(app.encryptKey).digest();
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
};

/** Posts an event the way Lark does with encryption on: encrypted body, signed headers. */
const deliver = async (event: object) => {
  const body = JSON.stringify({ encrypt: encrypt(JSON.stringify(event)) });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(8).toString('hex');
  const signature = createHash('sha256')
    .update(timestamp + nonce + app.encryptKey + body)
    .digest('hex');
  const response = await fetch(WEBHOOK, {
    body,
    headers: {
      'Content-Type': 'application/json',
      'x-lark-request-nonce': nonce,
      'x-lark-request-timestamp': timestamp,
      'x-lark-signature': signature,
    },
    method: 'POST',
  });
  return { status: response.status, text: await response.text() };
};

/** A store-app lifecycle event (v1 shape) */
const lifecycle = (event: Record<string, unknown>, token = app.token) => ({
  event: { app_id: app.appId, ...event },
  token,
  ts: String(Date.now() / 1000),
  type: 'event_callback',
  uuid: randomUUID(),
});

const main = async () => {
  if (!app.token || !app.encryptKey) {
    throw new Error(
      'Set SMOKE_LARK_TOKEN and SMOKE_LARK_ENCRYPT_KEY to what the app was stored with',
    );
  }

  const lark = await startFakeLarkApi(Number(process.env.SMOKE_LARK_API_PORT ?? 4070));
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const stamp = Date.now();
  const tenantKey = `tenant-${stamp}`;
  const openId = `ou_${stamp}`;
  const chatId = `oc_${stamp}`;
  const received = (text: string) => ({
    event: {
      message: {
        chat_id: chatId,
        chat_type: 'p2p',
        content: JSON.stringify({ text }),
        create_time: String(Date.now()),
        message_id: `om_in_${randomUUID()}`,
        message_type: 'text',
      },
      sender: {
        sender_id: { open_id: openId, union_id: `on_${stamp}`, user_id: `u_${stamp}` },
        sender_type: 'user',
        tenant_key: tenantKey,
      },
    },
    header: {
      app_id: app.appId,
      create_time: String(Date.now()),
      event_id: randomUUID(),
      event_type: 'im.message.receive_v1',
      tenant_key: tenantKey,
      token: app.token,
    },
    schema: '2.0',
  });
  const sentText = (pattern: RegExp) => lark.sent.find((message) => pattern.test(message.text));

  try {
    await step('the setup challenge is answered', async () => {
      const { text } = await deliver({
        challenge: 'challenge-123',
        token: app.token,
        type: 'url_verification',
      });
      if (JSON.parse(text).challenge !== 'challenge-123') throw new Error(text);
    });

    await step('a delivery with the wrong verification token is refused', async () => {
      const { status } = await deliver(lifecycle({ type: 'app_ticket', app_ticket: 'x' }, 'wrong'));
      if (status !== 401) throw new Error(`HTTP ${status}`);
    });

    await step('a company installs the app', async () => {
      for (const event of [
        lifecycle({ app_ticket: `ticket-${stamp}`, type: 'app_ticket' }),
        lifecycle({ installer: { open_id: openId }, tenant_key: tenantKey, type: 'app_open' }),
      ]) {
        const { status, text } = await deliver(event);
        if (status !== 200) throw new Error(`HTTP ${status}: ${text}`);
      }
    });

    const link = await step(
      'a person there is sent the link to connect their account',
      async () => {
        const { status } = await deliver(received('hi'));
        if (status !== 200) throw new Error(`HTTP ${status}`);
        const message = await waitFor('the welcome', async () => sentText(/verify-im/), 30_000);
        if (message.tenant !== tenantKey) throw new Error(`sent as tenant ${message.tenant}`);
        return new URL(message.text.match(/https?:\/\/[^\s"\\)]+/)![0]);
      },
    );

    const client = new SmokeClient(BASE_URL);
    await client.signUp(`lark-${Date.now()}@biber.test`, 'Smoke-pass-12345', 'Lark smoke');
    const { agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: { model: 'gpt-4o-mini', provider: 'openai', systemRole: '', title: 'Lark agent' },
    });

    await step('connecting the account confirms in Lark', async () => {
      await client.mutation('lambda', 'messenger.confirmLink', {
        initialAgentId: agentId,
        randomId: link.searchParams.get('random_id'),
      });
      const message = await waitFor(
        'the confirmation',
        async () => lark.sent.find((m) => m.to === openId),
        15_000,
      );
      if (message.tenant !== tenantKey) throw new Error(`sent as tenant ${message.tenant}`);
    });

    await step('a message gets the agent’s reply in Lark, as that company', async () => {
      await deliver(received('hello there'));
      const reply = await waitFor(
        'the reply',
        async () => sentText(/Hello from the fake model/),
        90_000,
      );
      if (reply.tenant !== tenantKey) throw new Error(`sent as tenant ${reply.tenant}`);
    });
  } finally {
    lark.close();
    model.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    if (process.env.SMOKE_VERBOSE) console.log(JSON.stringify(lark.sent, null, 1));
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
