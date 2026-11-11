import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

/** RSA key pairs as PEM, the form the env vars take. */
export const rsaPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });

export const signWith = (privateKey: string, content: string) =>
  createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');

/** What WeChat Pay does to a notification's payload: AES-256-GCM under the APIv3 key. */
export const wechatEncrypt = (
  apiV3Key: string,
  plaintext: string,
  associatedData = 'transaction',
) => {
  const nonce = randomBytes(6).toString('hex');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    associated_data: associatedData,
    ciphertext: data.toString('base64'),
    nonce,
    original_type: 'transaction',
  };
};

/** Headers WeChat Pay puts on a response or notification, signed with its private key. */
export const wechatHeaders = (
  platformPrivateKey: string,
  body: string,
  { serial = 'PUB_KEY_ID_TEST', timestamp = Math.floor(Date.now() / 1000) } = {},
) => {
  const nonce = randomBytes(16).toString('hex');
  return new Headers({
    'wechatpay-nonce': nonce,
    'wechatpay-serial': serial,
    'wechatpay-signature': signWith(platformPrivateKey, `${timestamp}\n${nonce}\n${body}\n`),
    'wechatpay-timestamp': String(timestamp),
  });
};
