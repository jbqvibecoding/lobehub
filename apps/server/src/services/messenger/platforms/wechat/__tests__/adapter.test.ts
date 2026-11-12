// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { inboundText, plainTextOf, WechatMpAdapter } from '../adapter';
import type { WechatMpApi } from '../api';
import { encryptedDelivery, SECRETS, textMessage } from './fixtures';

const setup = () => {
  const api = { sendImage: vi.fn(), sendText: vi.fn(), typing: vi.fn() };
  const chat = { getLogger: () => console, processMessage: vi.fn() };
  const adapter = new WechatMpAdapter(SECRETS, api as unknown as WechatMpApi);
  void adapter.initialize(chat as any);
  return { adapter, api, chat };
};

const post = ({ body, url }: { body: string; url: URL }) =>
  new Request(url, { body, method: 'POST' });

describe('WechatMpAdapter', () => {
  it("hands a follower's text to the Chat SDK in their one-to-one thread, and answers success", async () => {
    const { adapter, chat } = setup();
    const fields = textMessage('明天几点开会？', 'oAlice');

    const response = await adapter.handleWebhook(post(encryptedDelivery(fields)));

    expect(await response.text()).toBe('success');
    const [, threadId, message] = chat.processMessage.mock.calls[0];
    expect(threadId).toBe('wechatmp:oAlice');
    expect(message).toMatchObject({
      author: { isBot: false, userId: 'oAlice' },
      id: fields.MsgId,
      text: '明天几点开会？',
    });
  });

  it('passes an image along as an attachment', async () => {
    const { adapter, chat } = setup();
    const fields = {
      ...textMessage('', 'oBob'),
      MsgType: 'image',
      PicUrl: 'https://mmbiz.qpic.cn/x.jpg',
    };

    await adapter.handleWebhook(post(encryptedDelivery(fields)));

    expect(chat.processMessage.mock.calls[0][2].attachments).toEqual([
      expect.objectContaining({ type: 'image', url: 'https://mmbiz.qpic.cn/x.jpg' }),
    ]);
  });

  it('refuses a delivery WeChat did not sign', async () => {
    const { adapter, chat } = setup();
    const delivery = encryptedDelivery(textMessage('hi'));
    delivery.url.searchParams.set('msg_signature', 'forged');

    expect((await adapter.handleWebhook(post(delivery))).status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it('sends replies as plain text, since WeChat does not render markdown', async () => {
    const { adapter, api } = setup();

    await adapter.postMessage('wechatmp:oAlice', {
      markdown: '**明天** 10 点，[日历](https://x.y)',
    });

    expect(api.sendText).toHaveBeenCalledWith('oAlice', expect.not.stringContaining('**'));
  });
});

describe('what the bot reads', () => {
  it('takes text, transcribed voice, images, locations and links, and nothing else', () => {
    expect(inboundText({ Content: 'hi', MsgType: 'text' })).toBe('hi');
    expect(inboundText({ MsgType: 'voice', Recognition: '你好' })).toBe('你好');
    expect(inboundText({ MsgType: 'voice' })).toBeUndefined();
    expect(inboundText({ MsgType: 'image', PicUrl: 'u' })).toBe('');
    expect(
      inboundText({ Label: '上海', Location_X: '31.2', Location_Y: '121.4', MsgType: 'location' }),
    ).toBe('[位置] 上海 (31.2, 121.4)');
    expect(inboundText({ MsgType: 'video' })).toBeUndefined();
  });

  it('flattens every postable form to text', () => {
    expect(plainTextOf('plain')).toBe('plain');
    expect(plainTextOf({ markdown: '# Title' })).not.toContain('#');
    expect(plainTextOf({ raw: 'raw text' })).toBe('raw text');
  });
});
