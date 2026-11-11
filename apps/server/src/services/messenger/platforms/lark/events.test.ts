// @vitest-environment node
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { larkSignature, readLarkEvent } from './events';

const config = { encryptKey: 'encrypt-key', verificationToken: 'verify-token' };

const encrypt = (plaintext: string, key: string) => {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(key).digest(), iv);
  return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
};

const deliver = (event: unknown, { sign = true, signWith = config.encryptKey } = {}) => {
  const rawBody = JSON.stringify({ encrypt: encrypt(JSON.stringify(event), config.encryptKey) });
  const headers = new Headers();
  if (sign) {
    headers.set('x-lark-request-timestamp', '1731300000');
    headers.set('x-lark-request-nonce', 'nonce-1');
    headers.set('x-lark-signature', larkSignature('1731300000', 'nonce-1', signWith, rawBody));
  }
  return readLarkEvent(headers, rawBody, config);
};

const messageEvent = {
  event: { message: { chat_id: 'oc_1' } },
  header: { event_type: 'im.message.receive_v1', tenant_key: 'tenant-a', token: 'verify-token' },
  schema: '2.0',
};

describe('readLarkEvent', () => {
  it('decrypts a signed delivery carrying the right token', () => {
    const read = deliver(messageEvent);

    expect(read.ok).toBe(true);
    expect(read.ok && read.body.header?.tenant_key).toBe('tenant-a');
  });

  it('rejects a delivery without a signature', () => {
    expect(deliver(messageEvent, { sign: false })).toEqual({
      ok: false,
      reason: 'Missing signature',
    });
  });

  it('rejects a delivery signed with another key', () => {
    expect(deliver(messageEvent, { signWith: 'someone-else' })).toEqual({
      ok: false,
      reason: 'Invalid signature',
    });
  });

  it('rejects a delivery whose token does not match', () => {
    const read = deliver({ ...messageEvent, header: { ...messageEvent.header, token: 'wrong' } });

    expect(read).toEqual({ ok: false, reason: 'Invalid verification token' });
  });

  it('answers the setup challenge on the token alone, since it changes nothing', () => {
    const read = deliver(
      { challenge: 'abc', token: 'verify-token', type: 'url_verification' },
      { sign: false },
    );

    expect(read.ok && read.body.challenge).toBe('abc');
  });

  it('rejects an encrypted delivery when no encrypt key is configured', () => {
    const rawBody = JSON.stringify({ encrypt: encrypt('{}', 'k') });

    expect(
      readLarkEvent(new Headers(), rawBody, { verificationToken: 'verify-token' }),
    ).toMatchObject({ ok: false });
  });
});
