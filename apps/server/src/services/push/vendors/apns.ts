import { createPrivateKey, sign } from 'node:crypto';
import { type ClientHttp2Session, connect } from 'node:http2';

import debug from 'debug';

import {
  tokenHolder,
  type VendorNotification,
  VendorPushError,
  type VendorPushSender,
} from './types';

const log = debug('lobe-notification:push:apns');

export const APNS_ENDPOINTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
} as const;

/**
 * Apple refuses a provider token older than an hour and throttles one renewed more often than every
 * twenty minutes; `tokenHolder` renews five minutes before this, so after 50 minutes.
 */
const PROVIDER_TOKEN_SECONDS = 55 * 60;
const REQUEST_TIMEOUT_MS = 15_000;

/** Reasons Apple gives for a device token that will never work again. */
const GONE_REASONS = new Set(['BadDeviceToken', 'Unregistered']);
/** Reasons that mean the provider token itself was refused; a fresh one is worth one retry. */
const PROVIDER_TOKEN_REASONS = new Set(['ExpiredProviderToken', 'InvalidProviderToken']);

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** An APNs provider token: a JWT signed with the team's `.p8` key (ES256). */
export const apnsProviderToken = ({
  issuedAt = Date.now(),
  keyId,
  privateKey,
  teamId,
}: {
  issuedAt?: number;
  keyId: string;
  privateKey: string;
  teamId: string;
}) => {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iat: Math.floor(issuedAt / 1000), iss: teamId }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    dsaEncoding: 'ieee-p1363',
    key: createPrivateKey(privateKey.replaceAll('\\n', '\n')),
  });
  return `${header}.${claims}.${base64url(signature)}`;
};

/**
 * The payload as Expo's own push service lays it out, which is what the app's notification library
 * reads: the buttons come from `aps.category`, the fields the app reads on a tap from `body`.
 */
export const apnsPayload = ({ body, categoryId, data, title }: VendorNotification) => ({
  aps: {
    alert: { body, title },
    sound: 'default',
    ...(categoryId && { category: categoryId }),
  },
  ...(data && {
    body: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
  }),
});

const post = (
  session: ClientHttp2Session,
  path: string,
  headers: Record<string, string>,
  body: string,
) =>
  new Promise<{ reason?: string; status: number }>((resolve, reject) => {
    const request = session.request({ ':method': 'POST', ':path': path, ...headers });
    let status = 0;
    let text = '';
    request.setEncoding('utf8');
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.close();
      reject(new Error('APNs did not answer in time'));
    });
    request.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status']);
    });
    request.on('data', (chunk) => {
      text += chunk;
    });
    request.on('end', () => {
      let reason: string | undefined;
      try {
        reason = text ? (JSON.parse(text) as { reason?: string }).reason : undefined;
      } catch {
        reason = undefined;
      }
      resolve({ reason, status });
    });
    request.on('error', reject);
    request.end(body);
  });

/**
 * Apple Push Notification service, for the mainland iPhone app: its notifications go to Apple
 * directly rather than through Expo's servers abroad. One HTTP/2 connection per send, one request
 * per phone (APNs takes one device per request), authenticated with a provider token.
 */
export const createApnsSender = ({
  bundleId,
  endpoint,
  keyId,
  privateKey,
  teamId,
}: {
  /** The app's bundle id, which APNs calls the topic */
  bundleId: string;
  endpoint: string;
  keyId: string;
  privateKey: string;
  teamId: string;
}): VendorPushSender => {
  const providerToken = tokenHolder(async () => ({
    expiresInSeconds: PROVIDER_TOKEN_SECONDS,
    token: apnsProviderToken({ keyId, privateKey, teamId }),
  }));

  return {
    async send(tokens, notification) {
      const body = JSON.stringify(apnsPayload(notification));
      const session = connect(endpoint);
      // A connection error also fails the request in flight, which reports it; this only keeps
      // it from being thrown a second time as an unhandled event.
      session.on('error', (error) => log('connection error: %s', error.message));

      const sendTo = async (token: string) =>
        post(
          session,
          `/3/device/${token}`,
          {
            'apns-priority': '10',
            'apns-push-type': 'alert',
            'apns-topic': bundleId,
            'authorization': `bearer ${await providerToken.get()}`,
            'content-type': 'application/json',
          },
          body,
        );

      const invalidTokens: string[] = [];
      const failedTokens: string[] = [];
      try {
        for (const token of tokens) {
          let reply = await sendTo(token);
          if (reply.status === 403 && reply.reason && PROVIDER_TOKEN_REASONS.has(reply.reason)) {
            providerToken.clear();
            reply = await sendTo(token);
          }
          if (reply.status === 200) continue;
          if (reply.status === 410 || (reply.reason && GONE_REASONS.has(reply.reason))) {
            invalidTokens.push(token);
            continue;
          }
          // The key, team or bundle id is wrong: no other phone will fare better
          if (reply.status === 403 || reply.reason === 'DeviceTokenNotForTopic') {
            throw new VendorPushError('apns', `${reply.status} ${reply.reason ?? ''}`.trim());
          }
          log('refused one phone: %d %s', reply.status, reply.reason);
          failedTokens.push(token);
        }
      } finally {
        session.close();
      }
      return { failedTokens, invalidTokens };
    },
  };
};
