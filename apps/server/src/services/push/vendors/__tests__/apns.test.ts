// @vitest-environment node
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type Http2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { apnsProviderToken, createApnsSender } from '../apns';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

interface Received {
  headers: Record<string, string>;
  path: string;
  payload: any;
  tokenValid: boolean;
}

/** Whether a provider token is an ES256 JWT this key signed, for this key id and team. */
const checkProviderToken = (authorization: string) => {
  const [header, claims, signature] = authorization.replace(/^bearer /, '').split('.');
  const decoded = {
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
  };
  const signed = verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { dsaEncoding: 'ieee-p1363', key: publicKey },
    Buffer.from(signature, 'base64url'),
  );
  return (
    signed &&
    decoded.header.alg === 'ES256' &&
    decoded.header.kid === 'KEY123' &&
    decoded.claims.iss === 'TEAM456'
  );
};

let server: Http2Server;
let endpoint: string;
let received: Received[];
/** Replies Apple gives, by device token; anything else is accepted. */
let replies: Record<string, { reason: string; status: number }[]>;

beforeEach(async () => {
  received = [];
  replies = {};
  server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      const headers = request.headers as Record<string, string>;
      received.push({
        headers,
        path: headers[':path'],
        payload: JSON.parse(text),
        tokenValid: checkProviderToken(headers.authorization),
      });
      const device = headers[':path'].split('/').pop()!;
      const reply = replies[device]?.shift();
      response.writeHead(reply?.status ?? 200, { 'content-type': 'application/json' });
      response.end(reply ? JSON.stringify({ reason: reply.reason }) : '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const sender = () =>
  createApnsSender({
    bundleId: 'ai.biber.app.cn',
    endpoint,
    keyId: 'KEY123',
    privateKey: pem.replaceAll('\n', '\\n'),
    teamId: 'TEAM456',
  });

describe('APNs', () => {
  it('sends each phone an alert with its buttons and data, signed with the team key', async () => {
    const result = await sender().send(['aaa', 'bbb'], {
      body: 'Execute code is waiting for you',
      categoryId: 'approval',
      data: { toolMessageId: 'msg-1', url: undefined },
      title: 'Needs you',
    });

    expect(result).toEqual({ failedTokens: [], invalidTokens: [] });
    expect(received.map((r) => r.path)).toEqual(['/3/device/aaa', '/3/device/bbb']);
    expect(received[0].tokenValid).toBe(true);
    expect(received[0].headers).toMatchObject({
      'apns-priority': '10',
      'apns-push-type': 'alert',
      'apns-topic': 'ai.biber.app.cn',
    });
    expect(received[0].payload).toEqual({
      aps: {
        alert: { body: 'Execute code is waiting for you', title: 'Needs you' },
        category: 'approval',
        sound: 'default',
      },
      body: { toolMessageId: 'msg-1' },
    });
  });

  it('reports phones Apple no longer knows, and ones it refused only this time', async () => {
    replies = {
      bad: [{ reason: 'BadDeviceToken', status: 400 }],
      busy: [{ reason: 'TooManyRequests', status: 429 }],
      gone: [{ reason: 'Unregistered', status: 410 }],
    };

    const result = await sender().send(['gone', 'ok', 'bad', 'busy'], { body: 'b', title: 't' });

    expect(result).toEqual({ failedTokens: ['busy'], invalidTokens: ['gone', 'bad'] });
  });

  it('signs a fresh provider token once when Apple says it expired', async () => {
    replies = { aaa: [{ reason: 'ExpiredProviderToken', status: 403 }] };

    const result = await sender().send(['aaa'], { body: 'b', title: 't' });

    expect(result.invalidTokens).toEqual([]);
    expect(received).toHaveLength(2);
  });

  it('stops when the key or bundle id is wrong, since no phone would fare better', async () => {
    replies = { aaa: [{ reason: 'DeviceTokenNotForTopic', status: 400 }] };

    await expect(sender().send(['aaa', 'bbb'], { body: 'b', title: 't' })).rejects.toThrow(
      'apns push: 400 DeviceTokenNotForTopic',
    );
    expect(received).toHaveLength(1);
  });

  it('builds the provider token Apple expects', () => {
    const token = apnsProviderToken({
      issuedAt: Date.UTC(2026, 10, 18),
      keyId: 'KEY123',
      privateKey: pem,
      teamId: 'TEAM456',
    });

    expect(checkProviderToken(`bearer ${token}`)).toBe(true);
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toEqual({
      iat: Date.UTC(2026, 10, 18) / 1000,
      iss: 'TEAM456',
    });
  });
});
