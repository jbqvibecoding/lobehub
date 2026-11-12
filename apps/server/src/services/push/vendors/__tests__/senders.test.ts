// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHonorSender } from '../honor';
import { createHuaweiSender } from '../huawei';
import { createOppoSender } from '../oppo';
import { createVivoSender } from '../vivo';
import { createXiaomiSender } from '../xiaomi';

interface Call {
  body: any;
  headers: Record<string, string>;
  url: string;
}

let calls: Call[];
let replies: (object | { status: number; body: object })[];

const readBody = (body: unknown) => {
  if (body instanceof URLSearchParams) return Object.fromEntries(body);
  if (typeof body === 'string') return JSON.parse(body);
  return body;
};

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        body: readBody(init.body),
        headers: (init.headers ?? {}) as Record<string, string>,
        url,
      });
      const reply = replies.shift() ?? {};
      return 'status' in reply && 'body' in reply
        ? new Response(JSON.stringify(reply.body), { status: reply.status as number })
        : new Response(JSON.stringify(reply));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const notification = { body: '有一个操作等你确认', title: 'Biber' };

describe('Huawei', () => {
  const sender = () => createHuaweiSender({ appId: '10001', clientSecret: 's', category: 'WORK' });

  it('sends one message to all tokens with an open-app click action', async () => {
    replies.push({ access_token: 'at', expires_in: 3600 }, { code: '80000000', msg: 'Success' });

    expect(await sender().send(['t1', 't2'], notification)).toEqual({ invalidTokens: [] });
    expect(calls[0]).toMatchObject({
      body: { client_id: '10001', client_secret: 's', grant_type: 'client_credentials' },
      url: 'https://oauth-login.cloud.huawei.com/oauth2/v3/token',
    });
    expect(calls[1].url).toBe('https://push-api.cloud.huawei.com/v1/10001/messages:send');
    expect(calls[1].headers.Authorization).toBe('Bearer at');
    expect(calls[1].body).toEqual({
      message: {
        android: {
          category: 'WORK',
          notification: { body: notification.body, click_action: { type: 3 }, title: 'Biber' },
        },
        token: ['t1', 't2'],
      },
      validate_only: false,
    });
  });

  it('reports the tokens Huawei calls illegal, or all of them', async () => {
    replies.push(
      { access_token: 'at', expires_in: 3600 },
      { code: '80100000', msg: '{"success":1,"failure":1,"illegal_tokens":["t2"]}' },
    );
    const huawei = sender();
    expect(await huawei.send(['t1', 't2'], notification)).toEqual({ invalidTokens: ['t2'] });

    replies.push({ code: '80300007', msg: 'All the tokens are invalid' });
    expect(await huawei.send(['t3'], notification)).toEqual({ invalidTokens: ['t3'] });
  });

  it('fetches a new access token once when Huawei rejects it', async () => {
    replies.push(
      { access_token: 'old', expires_in: 3600 },
      { body: { code: '80200003' }, status: 401 },
      { access_token: 'new', expires_in: 3600 },
      { code: '80000000' },
    );

    await sender().send(['t1'], notification);
    expect(calls[3].headers.Authorization).toBe('Bearer new');
  });
});

describe('Honor', () => {
  it('sends with a bearer token and reports expired tokens', async () => {
    replies.push(
      { access_token: 'hat', expires_in: 3600 },
      { code: 200, data: { expireTokens: ['h2'], sendResult: true }, message: 'success' },
    );

    const result = await createHonorSender({
      appId: '104',
      clientId: 'cid',
      clientSecret: 'cs',
    }).send(['h1', 'h2'], notification);

    expect(result).toEqual({ invalidTokens: ['h2'] });
    expect(calls[1].url).toBe('https://push-api.cloud.hihonor.com/api/v1/104/sendMessage');
    expect(calls[1].headers.Authorization).toBe('Bearer hat');
    expect(calls[1].body).toEqual({
      android: {
        notification: { body: notification.body, clickAction: { type: 3 }, title: 'Biber' },
      },
      token: ['h1', 'h2'],
    });
  });
});

describe('Xiaomi', () => {
  it('sends to the registration ids with the AppSecret, on the private channel', async () => {
    replies.push({ code: 0, data: { bad_regids: 'x2' }, result: 'ok' });

    const result = await createXiaomiSender({
      appSecret: 'secret',
      channelId: '123',
      packageName: 'ai.biber.app.cn',
    }).send(['x1', 'x2'], notification);

    expect(result).toEqual({ invalidTokens: ['x2'] });
    expect(calls[0].url).toBe('https://api.xmpush.xiaomi.com/v3/message/regid');
    expect(calls[0].headers.Authorization).toBe('key=secret');
    expect(calls[0].body).toMatchObject({
      'description': notification.body,
      'extra.channel_id': '123',
      'extra.notify_effect': '1',
      'registration_id': 'x1,x2',
      'restricted_package_name': 'ai.biber.app.cn',
      'title': 'Biber',
    });
  });

  it('throws on an error result', async () => {
    replies.push({ code: 22_022, reason: 'invalid app secret', result: 'error' });

    await expect(
      createXiaomiSender({ appSecret: 'bad', packageName: 'p' }).send(['x1'], notification),
    ).rejects.toThrow('invalid app secret');
  });
});

describe('OPPO', () => {
  it('signs the auth request and sends a batch through the auth token', async () => {
    replies.push(
      { code: 0, data: { auth_token: 'oat' } },
      {
        code: 0,
        data: [
          { messageId: 'm1', registrationId: 'o1' },
          { errorCode: 10_000, registrationId: 'o2' },
        ],
      },
    );

    const result = await createOppoSender({
      appKey: 'key',
      channelId: 'todo',
      masterSecret: 'master',
    }).send(['o1', 'o2'], notification);

    expect(result).toEqual({ invalidTokens: ['o2'] });
    const auth = calls[0].body;
    expect(auth.sign).toBe(createHash('sha256').update(`key${auth.timestamp}master`).digest('hex'));
    expect(calls[1].url).toBe(
      'https://api.push.oppomobile.com/server/v1/message/notification/unicast_batch',
    );
    expect(calls[1].headers.auth_token).toBe('oat');
    expect(JSON.parse(calls[1].body.messages)).toEqual([
      expect.objectContaining({
        notification: expect.objectContaining({
          channel_id: 'todo',
          click_action_type: 0,
          content: notification.body,
          title: 'Biber',
        }),
        target_type: 2,
        target_value: 'o1',
      }),
      expect.objectContaining({ target_value: 'o2' }),
    ]);
  });
});

describe('vivo', () => {
  it('signs the auth request and sends each phone a system message', async () => {
    replies.push(
      { authToken: 'vat', result: 0 },
      { result: 0, taskId: '1' },
      { invalidUser: { status: 2, userid: 'v2' }, result: 0 },
    );

    const result = await createVivoSender({
      appId: '100',
      appKey: 'k',
      appSecret: 's',
    }).send(['v1', 'v2'], { body: '很'.repeat(150), title: notification.title });

    expect(result).toEqual({ invalidTokens: ['v2'] });
    const auth = calls[0].body;
    expect(auth.sign).toBe(createHash('md5').update(`100k${auth.timestamp}s`).digest('hex'));
    expect(calls[1].headers.authToken).toBe('vat');
    expect(calls[1].body).toMatchObject({
      category: 'TODO',
      classification: 1,
      regId: 'v1',
      skipType: 1,
      title: 'Biber',
    });
    expect([...calls[1].body.content]).toHaveLength(100);
  });
});
