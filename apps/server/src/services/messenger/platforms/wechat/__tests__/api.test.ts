// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWechatMpApi, splitWechatText } from '../api';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));

const json = (body: object) => new Response(JSON.stringify(body));

let calls: { body: any; url: string }[];
let replies: Response[];

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
        url,
      });
      return replies.shift() ?? json({ errcode: 0, errmsg: 'ok' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('splitting text', () => {
  it('keeps every piece within the byte limit without cutting a character', () => {
    const text = '你好'.repeat(500);
    const pieces = splitWechatText(text, 100);

    expect(pieces.every((piece) => Buffer.byteLength(piece) <= 100)).toBe(true);
    expect(pieces.join('')).toBe(text);
  });

  it('prefers a line break near the limit', () => {
    expect(splitWechatText(`${'a'.repeat(60)}\n${'b'.repeat(60)}`, 100)).toEqual([
      'a'.repeat(60),
      'b'.repeat(60),
    ]);
    expect(splitWechatText('short')).toEqual(['short']);
  });
});

describe('the WeChat API', () => {
  it('sends a long reply as several customer-service messages with one shared token', async () => {
    const appId = `wx_${Date.now()}_a`;
    replies.push(json({ access_token: 'token-1', expires_in: 7200 }));
    const api = createWechatMpApi({ appId, appSecret: 'secret' });

    await api.sendText('oUser1', `${'甲'.repeat(600)}\n${'乙'.repeat(600)}`);

    expect(calls[0]).toMatchObject({
      body: {
        appid: appId,
        force_refresh: false,
        grant_type: 'client_credential',
        secret: 'secret',
      },
      url: 'https://api.weixin.qq.com/cgi-bin/stable_token',
    });
    const sends = calls.slice(1);
    expect(sends).toHaveLength(2);
    expect(sends[0].url).toBe(
      'https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=token-1',
    );
    expect(sends[0].body).toEqual({
      msgtype: 'text',
      text: { content: '甲'.repeat(600) },
      touser: 'oUser1',
    });
  });

  it('fetches a fresh token once when WeChat says the token expired', async () => {
    const appId = `wx_${Date.now()}_b`;
    replies.push(
      json({ access_token: 'old', expires_in: 7200 }),
      json({ errcode: 42_001, errmsg: 'access_token expired' }),
      json({ access_token: 'new', expires_in: 7200 }),
      json({ errcode: 0 }),
    );
    const api = createWechatMpApi({ appId, appSecret: 'secret' });

    await api.typing('oUser1');

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      'https://api.weixin.qq.com/cgi-bin/message/custom/typing?access_token=old',
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      'https://api.weixin.qq.com/cgi-bin/message/custom/typing?access_token=new',
    ]);
    expect(calls[2].body.force_refresh).toBe(true);
  });

  it('reports other WeChat errors, such as a reply past the 48-hour window', async () => {
    const appId = `wx_${Date.now()}_c`;
    replies.push(
      json({ access_token: 't', expires_in: 7200 }),
      json({ errcode: 45_015, errmsg: 'response out of time limit' }),
    );

    await expect(
      createWechatMpApi({ appId, appSecret: 's' }).sendText('oUser1', 'hi'),
    ).rejects.toMatchObject({ errcode: 45_015 });
  });

  it('makes the follow QR code once and reuses it', async () => {
    const appId = `wx_${Date.now()}_d`;
    replies.push(
      json({ access_token: 't', expires_in: 7200 }),
      json({ ticket: 'T', url: 'http://weixin.qq.com/q/abc' }),
    );
    const api = createWechatMpApi({ appId, appSecret: 's' });

    expect(await api.followQrUrl()).toBe('http://weixin.qq.com/q/abc');
    expect(await api.followQrUrl()).toBe('http://weixin.qq.com/q/abc');
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({
      action_info: { scene: { scene_str: 'biber' } },
      action_name: 'QR_LIMIT_STR_SCENE',
    });
  });
});
