// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wechatSignature } from '../protocol';
import { wechatWebhookGate } from '../webhook';
import { encryptedDelivery, SECRETS, textMessage } from './fixtures';

const { greet, sendDmText } = vi.hoisted(() => ({ greet: vi.fn(), sendDmText: vi.fn() }));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/config/messenger', () => ({ getMessengerWechatConfig: async () => SECRETS }));
vi.mock('../binder', () => ({
  MessengerWechatBinder: class {
    greet = greet;
    sendDmText = sendDmText;
  },
}));

const ctx = { invalidateBot: vi.fn() };
const deliver = (fields: Record<string, string>) => {
  const { body, url } = encryptedDelivery(fields);
  return wechatWebhookGate.preprocess(new Request(url, { body, method: 'POST' }), body, ctx);
};

beforeEach(() => {
  greet.mockReset();
  sendDmText.mockReset();
});

describe('the WeChat webhook gate', () => {
  it("answers WeChat's server URL check", async () => {
    const url = new URL('https://app.biber.test/hook?timestamp=1&nonce=2&echostr=ping');
    url.searchParams.set('signature', wechatSignature(SECRETS.token, '1', '2'));

    const response = await wechatWebhookGate.handleGet!(new Request(url));
    expect(await response.text()).toBe('ping');

    url.searchParams.set('signature', 'forged');
    expect((await wechatWebhookGate.handleGet!(new Request(url))).status).toBe(401);
  });

  it('greets a new follower once, even when WeChat delivers the event twice', async () => {
    const event = {
      CreateTime: String(Math.floor(Date.now() / 1000)),
      Event: 'subscribe',
      EventKey: 'qrscene_biber',
      FromUserName: `oNew${Date.now()}`,
      MsgType: 'event',
      ToUserName: 'gh_biber',
    };

    const first = await deliver(event);
    await deliver(event);

    expect(await first!.text()).toBe('success');
    expect(greet).toHaveBeenCalledTimes(1);
    expect(greet).toHaveBeenCalledWith(event.FromUserName);
  });

  it('acknowledges other events without a reply', async () => {
    const response = await deliver({
      CreateTime: '1',
      Event: 'unsubscribe',
      FromUserName: 'oGone',
      MsgType: 'event',
    });

    expect(await response!.text()).toBe('success');
    expect(greet).not.toHaveBeenCalled();
  });

  it('tells the follower when it cannot read a message, and lets text through', async () => {
    await deliver({ ...textMessage('', `oVid${Date.now()}`), MsgType: 'video' });
    expect(sendDmText).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('文字'));

    expect(await deliver(textMessage('你好'))).toBeNull();
  });

  it('refuses deliveries WeChat did not sign', async () => {
    const { body, url } = encryptedDelivery(textMessage('hi'));
    url.searchParams.set('signature', 'forged');

    const response = await wechatWebhookGate.preprocess(
      new Request(url, { body, method: 'POST' }),
      body,
      ctx,
    );
    expect(response!.status).toBe(401);
  });
});
