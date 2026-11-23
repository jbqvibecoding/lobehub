import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * The WeChat Official Account (服务号) message protocol: how WeChat checks our server URL, signs
 * each delivery, and encrypts it in safe mode (安全模式), plus the flat XML it is written in.
 */
export interface WechatMpSecrets {
  appId: string;
  /** 43 characters; set when the account delivers messages encrypted (safe mode) */
  encodingAESKey?: string;
  /** The token entered with the server URL; it signs every delivery */
  token: string;
}

/** A delivery's fields, e.g. `MsgType`, `FromUserName` (the sender's openid), `Content`. */
export type WechatMpFields = Record<string, string>;

export class WechatMpVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WechatMpVerificationError';
  }
}

/** A signature older or newer than this is refused, so a captured delivery cannot be replayed later. */
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/** SHA-1 over the sorted, concatenated parts, as WeChat signs. */
export const wechatSignature = (...parts: string[]) =>
  createHash('sha1')
    .update([...parts].sort().join(''))
    .digest('hex');

const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const checkTimestamp = (timestamp: string, now: Date) => {
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    throw new WechatMpVerificationError('The delivery signature has expired');
  }
};

/**
 * WeChat's check of the server URL (a GET): answers its `echostr` when the signature matches, or
 * nothing. The URL check is signed the same way in every message mode.
 */
export const answerUrlCheck = (secrets: WechatMpSecrets, url: URL): string | undefined => {
  const signature = url.searchParams.get('signature') ?? '';
  const timestamp = url.searchParams.get('timestamp') ?? '';
  const nonce = url.searchParams.get('nonce') ?? '';
  const echostr = url.searchParams.get('echostr');
  if (!echostr || !sameText(wechatSignature(secrets.token, timestamp, nonce), signature)) {
    return undefined;
  }
  return echostr;
};

/** The AES key is the 43-character EncodingAESKey, base64 without its padding. */
const aesKeyOf = (encodingAESKey: string) => {
  const key = Buffer.from(`${encodingAESKey}=`, 'base64');
  if (key.length !== 32) throw new Error('The EncodingAESKey must be 43 characters');
  return key;
};

/**
 * Safe-mode encryption: AES-256-CBC with the key's first 16 bytes as IV, over 16 random bytes,
 * the message length (4 bytes, big-endian), the message, and the app id, PKCS#7-padded to 32.
 */
export const encryptForWechat = (
  secrets: Required<Pick<WechatMpSecrets, 'appId' | 'encodingAESKey'>>,
  message: string,
  random = randomBytes(16),
) => {
  const key = aesKeyOf(secrets.encodingAESKey);
  const body = Buffer.from(message, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const plain = Buffer.concat([random, length, body, Buffer.from(secrets.appId, 'utf8')]);
  const pad = 32 - (plain.length % 32);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(false);
  return Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.alloc(pad, pad)])),
    cipher.final(),
  ]).toString('base64');
};

export const decryptFromWechat = (
  secrets: Required<Pick<WechatMpSecrets, 'appId' | 'encodingAESKey'>>,
  encrypted: string,
) => {
  const key = aesKeyOf(secrets.encodingAESKey);
  let message: string;
  let appId: string;
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(
      false,
    );
    const padded = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);
    const pad = padded.at(-1) ?? 0;
    if (pad < 1 || pad > 32) throw new Error('bad padding');
    const plain = padded.subarray(0, padded.length - pad);

    const length = plain.readUInt32BE(16);
    if (20 + length > plain.length) throw new Error('bad length');
    message = plain.subarray(20, 20 + length).toString('utf8');
    appId = plain.subarray(20 + length).toString('utf8');
  } catch {
    throw new WechatMpVerificationError('The delivery does not decrypt');
  }
  if (appId !== secrets.appId) {
    throw new WechatMpVerificationError('The delivery is for another account');
  }
  return message;
};

/**
 * The fields of a WeChat XML message. Deliveries are one flat `<xml>` element whose children hold
 * text, mostly as CDATA; nested elements (some menu events) are skipped. Nothing else of XML is
 * read, so there are no entities or DTDs to abuse.
 */
export const readWechatXml = (xml: string): WechatMpFields => {
  const root = /<xml>([\s\S]*)<\/xml>/.exec(xml)?.[1];
  if (root === undefined) throw new WechatMpVerificationError('The delivery is not WeChat XML');

  const fields: WechatMpFields = {};
  const openTag = /<(\w+)>/g;
  let position = 0;
  for (;;) {
    openTag.lastIndex = position;
    const open = openTag.exec(root);
    if (!open) break;

    // Find the matching close, stepping over CDATA, which may contain anything
    const close = `</${open[1]}>`;
    const start = open.index + open[0].length;
    let at = start;
    let end = -1;
    while (at < root.length) {
      if (root.startsWith('<![CDATA[', at)) {
        const cdataEnd = root.indexOf(']]>', at);
        if (cdataEnd < 0) break;
        at = cdataEnd + 3;
      } else if (root.startsWith(close, at)) {
        end = at;
        break;
      } else {
        at += 1;
      }
    }
    if (end < 0) break;

    const inner = root.slice(start, end);
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(inner);
    if (cdata) fields[open[1]] = cdata[1];
    else if (!inner.includes('<')) fields[open[1]] = inner;
    position = end + close.length;
  }
  return fields;
};

/**
 * Verifies a message or event WeChat posted and returns its fields, decrypted when the account is
 * in safe mode. With an EncodingAESKey set, plain deliveries are refused: in plain mode the
 * signature does not cover the body, so only encrypted deliveries are trusted then.
 */
export const readDelivery = (
  secrets: WechatMpSecrets,
  url: URL,
  body: string,
  now = new Date(),
): WechatMpFields => {
  const timestamp = url.searchParams.get('timestamp') ?? '';
  const nonce = url.searchParams.get('nonce') ?? '';
  const signature = url.searchParams.get('signature') ?? '';
  if (!sameText(wechatSignature(secrets.token, timestamp, nonce), signature)) {
    throw new WechatMpVerificationError('The delivery signature does not match');
  }
  checkTimestamp(timestamp, now);

  const outer = readWechatXml(body);
  if (!secrets.encodingAESKey) return outer;

  const encrypted = outer.Encrypt;
  const messageSignature = url.searchParams.get('msg_signature') ?? '';
  if (!encrypted || url.searchParams.get('encrypt_type') !== 'aes') {
    throw new WechatMpVerificationError('The delivery is not encrypted');
  }
  if (!sameText(wechatSignature(secrets.token, timestamp, nonce, encrypted), messageSignature)) {
    throw new WechatMpVerificationError('The delivery signature does not match');
  }
  return readWechatXml(
    decryptFromWechat({ appId: secrets.appId, encodingAESKey: secrets.encodingAESKey }, encrypted),
  );
};
