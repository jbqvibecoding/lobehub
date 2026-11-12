import { randomBytes } from 'node:crypto';

import { encryptForWechat, wechatSignature } from '../protocol';

export const SECRETS = {
  appId: 'wx1234567890abcdef',
  // 43 characters of base64, as the WeChat console generates
  encodingAESKey: randomBytes(32).toString('base64').slice(0, 43),
  token: 'biber-token',
};

export const xml = (fields: Record<string, string>) =>
  `<xml>${Object.entries(fields)
    .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
    .join('')}</xml>`;

/** The URL and body WeChat posts for a message in safe mode. */
export const encryptedDelivery = (
  fields: Record<string, string>,
  { secrets = SECRETS, timestamp = String(Math.floor(Date.now() / 1000)) } = {},
) => {
  const nonce = randomBytes(4).toString('hex');
  const encrypted = encryptForWechat(secrets, xml(fields));
  const url = new URL('https://app.biber.test/api/agent/messenger/webhooks/wechat');
  url.searchParams.set('signature', wechatSignature(secrets.token, timestamp, nonce));
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('openid', fields.FromUserName ?? '');
  url.searchParams.set('encrypt_type', 'aes');
  url.searchParams.set(
    'msg_signature',
    wechatSignature(secrets.token, timestamp, nonce, encrypted),
  );
  return { body: xml({ Encrypt: encrypted, ToUserName: 'gh_biber' }), url };
};

export const textMessage = (content: string, openId = 'oUser1') => ({
  Content: content,
  CreateTime: String(Math.floor(Date.now() / 1000)),
  FromUserName: openId,
  MsgId: String(Date.now()),
  MsgType: 'text',
  ToUserName: 'gh_biber',
});
