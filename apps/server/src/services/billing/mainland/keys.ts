import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

/** Env values often hold PEM with literal `\n`, or only the base64 body as the providers hand it out. */
const unescape = (text: string) => text.trim().replaceAll('\\n', '\n');

const der = (text: string) => Buffer.from(text.replaceAll(/\s+/g, ''), 'base64');

/** An RSA private key from PEM, or from bare base64 in PKCS#8 or PKCS#1 form. */
export const readPrivateKey = (text: string): KeyObject => {
  const value = unescape(text);
  if (value.includes('-----BEGIN')) return createPrivateKey(value);
  try {
    return createPrivateKey({ format: 'der', key: der(value), type: 'pkcs8' });
  } catch {
    return createPrivateKey({ format: 'der', key: der(value), type: 'pkcs1' });
  }
};

/** An RSA public key from PEM, or from bare base64 (SubjectPublicKeyInfo). */
export const readPublicKey = (text: string): KeyObject => {
  const value = unescape(text);
  if (value.includes('-----BEGIN')) return createPublicKey(value);
  return createPublicKey({ format: 'der', key: der(value), type: 'spki' });
};

/** Wall-clock parts in Beijing time (UTC+8, no daylight saving), as both providers expect. */
export const beijingParts = (date: Date) => {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`,
  };
};
