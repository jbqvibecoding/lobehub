import { createHash, timingSafeEqual } from 'node:crypto';

import { decryptLarkEvent } from '@lobechat/chat-adapter-feishu';

import type { MessengerLarkConfig } from '@/config/messenger';

/**
 * A Lark event body after decryption. Store-app lifecycle events (`app_ticket`, `app_open`, ...)
 * use the v1 shape (`type: 'event_callback'`, details in `event`); message events use v2
 * (`header.event_type`, `header.tenant_key`).
 */
export interface LarkEventBody {
  challenge?: string;
  event?: Record<string, any>;
  header?: { event_type?: string; tenant_key?: string; token?: string };
  token?: string;
  type?: string;
}

type ReadResult = { body: LarkEventBody; ok: true } | { ok: false; reason: string };

/** Lark's delivery signature: sha256 over timestamp, nonce, encrypt key and the raw body. */
export const larkSignature = (
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string,
): string =>
  createHash('sha256')
    .update(timestamp + nonce + encryptKey + rawBody)
    .digest('hex');

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Decrypts and authenticates one delivery. With an encrypt key, every event but the setup
 * challenge must carry a valid signature; the verification token must match in all cases.
 */
export const readLarkEvent = (
  headers: Headers,
  rawBody: string,
  config: Pick<MessengerLarkConfig, 'encryptKey' | 'verificationToken'>,
): ReadResult => {
  let body: LarkEventBody & { encrypt?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'Invalid JSON' };
  }

  if (body.encrypt) {
    if (!config.encryptKey) return { ok: false, reason: 'Encrypted event without an encrypt key' };
    try {
      body = JSON.parse(decryptLarkEvent(body.encrypt, config.encryptKey));
    } catch {
      return { ok: false, reason: 'Event decryption failed' };
    }
  }

  // The setup challenge only echoes its own value back, so it is answered on the token alone.
  if (config.encryptKey && body.type !== 'url_verification') {
    const timestamp = headers.get('x-lark-request-timestamp');
    const nonce = headers.get('x-lark-request-nonce');
    const signature = headers.get('x-lark-signature');
    if (!timestamp || !nonce || !signature) return { ok: false, reason: 'Missing signature' };
    if (!sameText(larkSignature(timestamp, nonce, config.encryptKey, rawBody), signature)) {
      return { ok: false, reason: 'Invalid signature' };
    }
  }

  const token = body.header?.token ?? body.token;
  if (!token || !sameText(token, config.verificationToken)) {
    return { ok: false, reason: 'Invalid verification token' };
  }

  return { body, ok: true };
};

/** The tenant an event comes from, in either event shape. */
export const larkTenantKey = (body: LarkEventBody): string | undefined =>
  body.header?.tenant_key ?? body.event?.tenant_key ?? undefined;
