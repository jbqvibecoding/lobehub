/**
 * The shared WeChat Official Account bot, against a running server: WeChat checks the server URL,
 * a new follower is sent the link that connects their account, they confirm it on the web and send
 * the code the page shows from WeChat (the same code from another WeChat links nothing), and a
 * message they send gets the agent's reply. An action that needs approval is answered in the chat: "1" approves
 * it, and any other reply refuses it and is passed on to the agent. Every delivery is encrypted and
 * signed as WeChat does it in safe mode.
 *
 *   bunx tsx scripts/biber/smoke/wechat-bot.ts
 *
 * Before running, store the bot pointed at this script's stand-in for WeChat's API:
 *   echo '{"appSecret":"smoke","token":"<SMOKE_WECHAT_TOKEN>","encodingAESKey":"<SMOKE_WECHAT_AES_KEY>"}' |
 *     bunx tsx scripts/biber/ops.ts bot set wechat --application-id <SMOKE_WECHAT_APP_ID> \
 *       --settings '{"apiBaseUrl":"http://127.0.0.1:4040"}'
 * The server's OPENAI_PROXY_URL must point at this script's fake model (port 4010).
 */
import { randomBytes } from 'node:crypto';

import {
  encryptForWechat,
  wechatSignature,
} from '../../../apps/server/src/services/messenger/platforms/wechat/protocol';
import { SmokeClient, waitFor } from './client';
import { startFakeModel, startFakeWechatApi } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3011';
const WEBHOOK = `${BASE_URL}/api/agent/messenger/webhooks/wechat`;
const secrets = {
  appId: process.env.SMOKE_WECHAT_APP_ID ?? 'wx_smoke_app',
  encodingAESKey: process.env.SMOKE_WECHAT_AES_KEY!,
  token: process.env.SMOKE_WECHAT_TOKEN!,
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

const xml = (fields: Record<string, string>) =>
  `<xml>${Object.entries(fields)
    .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
    .join('')}</xml>`;

/** Posts a message or event the way WeChat does in safe mode. */
const deliver = async (fields: Record<string, string>) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(4).toString('hex');
  const encrypted = encryptForWechat(secrets, xml(fields));
  const url = new URL(WEBHOOK);
  url.searchParams.set('signature', wechatSignature(secrets.token, timestamp, nonce));
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('openid', fields.FromUserName);
  url.searchParams.set('encrypt_type', 'aes');
  url.searchParams.set(
    'msg_signature',
    wechatSignature(secrets.token, timestamp, nonce, encrypted),
  );
  const response = await fetch(url, {
    body: xml({ Encrypt: encrypted, ToUserName: 'gh_biber' }),
    headers: { 'Content-Type': 'text/xml' },
    method: 'POST',
  });
  return { status: response.status, text: await response.text() };
};

const main = async () => {
  if (!secrets.token || !secrets.encodingAESKey) {
    throw new Error(
      'Set SMOKE_WECHAT_TOKEN and SMOKE_WECHAT_AES_KEY to what the bot was stored with',
    );
  }
  const wechat = await startFakeWechatApi(Number(process.env.SMOKE_WECHAT_API_PORT ?? 4040));
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const openId = `oSmoke${Date.now()}`;
  const sentTo = (text: RegExp) => wechat.sent.find((m) => m.to === openId && text.test(m.content));
  const countSent = (text: RegExp) =>
    wechat.sent.filter((m) => m.to === openId && text.test(m.content)).length;
  const say = async (content: string) => {
    const { text } = await deliver({
      Content: content,
      CreateTime: String(Math.floor(Date.now() / 1000)),
      FromUserName: openId,
      MsgId: String(Date.now()),
      MsgType: 'text',
      ToUserName: 'gh_biber',
    });
    if (text !== 'success') throw new Error(`webhook answered ${text}`);
  };

  try {
    await step("WeChat's server URL check is answered", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const url = new URL(WEBHOOK);
      url.searchParams.set('signature', wechatSignature(secrets.token, timestamp, 'n1'));
      url.searchParams.set('timestamp', timestamp);
      url.searchParams.set('nonce', 'n1');
      url.searchParams.set('echostr', 'echo-123');
      const response = await fetch(url);
      const text = await response.text();
      if (text !== 'echo-123') throw new Error(`HTTP ${response.status}: ${text}`);
    });

    await step('a forged delivery is refused', async () => {
      const response = await fetch(`${WEBHOOK}?signature=x&timestamp=1&nonce=1`, {
        body: xml({ Content: 'hi', FromUserName: openId, MsgType: 'text' }),
        method: 'POST',
      });
      if (response.status !== 401) throw new Error(`HTTP ${response.status}`);
    });

    const link = await step(
      'a new follower is sent the link to connect their account',
      async () => {
        const { text } = await deliver({
          CreateTime: String(Math.floor(Date.now() / 1000)),
          Event: 'subscribe',
          EventKey: 'qrscene_biber',
          FromUserName: openId,
          MsgType: 'event',
          ToUserName: 'gh_biber',
        });
        if (text !== 'success') throw new Error(`webhook answered ${text}`);
        const message = await waitFor('the welcome', async () => sentTo(/verify-im/), 15_000);
        return new URL(message.content.match(/https?:\/\/\S+/)![0]);
      },
    );

    const client = new SmokeClient(BASE_URL);
    await client.signUp(`wechat-${Date.now()}@biber.test`, 'Smoke-pass-12345', 'WeChat smoke');
    const { agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: {
        agencyConfig: { executionTarget: 'sandbox' },
        model: 'gpt-4o-mini',
        plugins: ['lobe-cloud-sandbox'],
        provider: 'openai',
        systemRole: '',
        title: 'WeChat agent',
      },
    });

    const code = await step('confirming on the web shows a code to send from WeChat', async () => {
      const result = await client.mutation<{ awaitingCode?: { code: string } }>(
        'lambda',
        'messenger.confirmLink',
        { initialAgentId: agentId, randomId: link.searchParams.get('random_id') },
      );
      if (!result.awaitingCode?.code) throw new Error(`no code: ${JSON.stringify(result)}`);
      await waitFor('the request for the code', async () => sentTo(/网页上已确认/), 15_000);
      return result.awaitingCode.code;
    });

    await step('the same code from another WeChat links nothing', async () => {
      const other = `oOther${Date.now()}`;
      const { text } = await deliver({
        Content: code,
        CreateTime: String(Math.floor(Date.now() / 1000)),
        FromUserName: other,
        MsgId: String(Date.now()),
        MsgType: 'text',
        ToUserName: 'gh_biber',
      });
      if (text !== 'success') throw new Error(`webhook answered ${text}`);
      // A stranger is simply asked to link their own account
      await waitFor(
        'a link for the other WeChat',
        async () => wechat.sent.find((m) => m.to === other && /verify-im/.test(m.content)),
        15_000,
      );
    });

    await step('sending the code from this WeChat links it', async () => {
      await say(code);
      await waitFor('the confirmation', async () => sentTo(/绑定成功/), 15_000);
    });

    await step('a message gets the agent’s reply in WeChat', async () => {
      await say('你好');
      await waitFor('the reply', async () => sentTo(/Hello from the fake model/), 90_000);
    });

    const PROMPT = /回复 1 批准，2 拒绝/;

    await step('an action that needs approval asks for 1 or 2 in WeChat', async () => {
      await say('Please run code that adds one and one.');
      await waitFor('the approval request', async () => sentTo(PROMPT), 90_000);
    });

    await step('replying 1 approves it and the reply arrives', async () => {
      await say('1');
      await waitFor('the answer', async () => sentTo(/已批准：/), 15_000);
      await waitFor(
        'the reply after the approved action',
        async () => sentTo(/The code ran/),
        90_000,
      );
    });

    await step('replying anything else refuses it and tells the agent', async () => {
      await say('Please run code that adds two and two.');
      await waitFor(
        'a second approval request',
        async () => countSent(PROMPT) >= 2 || undefined,
        90_000,
      );
      await say('先别运行，直接告诉我答案');
      await waitFor('the answer', async () => sentTo(/已把你的话转告助理/), 15_000);
      await waitFor('the agent’s reply', async () => sentTo(/left the code alone/), 90_000);
    });
  } finally {
    wechat.close();
    model.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    if (process.env.SMOKE_VERBOSE) console.log(JSON.stringify(wechat.sent, null, 1));
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
