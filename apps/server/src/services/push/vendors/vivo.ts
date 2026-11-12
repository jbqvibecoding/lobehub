import { createHash, randomUUID } from 'node:crypto';

import { tokenHolder, VendorPushError, type VendorPushSender } from './types';

const API = 'https://api-push.vivo.com.cn';

/** vivo's limits on what a notification shows */
const MAX_TITLE = 40;
const MAX_CONTENT = 100;

/** `invalidUser.status`: 1 = not a user of this app, 2 = uninstalled or unsubscribed */
const GONE_STATUSES = new Set([1, 2]);

const clip = (text: string, max: number) =>
  [...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text;

/** vivo Push, for vivo and iQOO phones. One request per phone. */
export const createVivoSender = ({
  appId,
  appKey,
  appSecret,
  category = 'TODO',
}: {
  appId: string;
  appKey: string;
  appSecret: string;
  /** The system-message category vivo approved for the app */
  category?: string;
}): VendorPushSender => {
  const authToken = tokenHolder(async () => {
    const timestamp = Date.now();
    const response = await fetch(`${API}/message/auth`, {
      body: JSON.stringify({
        appId,
        appKey,
        sign: createHash('md5').update(`${appId}${appKey}${timestamp}${appSecret}`).digest('hex'),
        timestamp,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const data: { authToken?: string; desc?: string; result?: number } = await response
      .json()
      .catch(() => ({}));
    if (data.result !== 0 || !data.authToken) {
      throw new VendorPushError(
        'vivo',
        `auth: ${data.result ?? response.status} ${data.desc ?? ''}`,
      );
    }
    // Valid for a day; vivo also limits how often a new one may be fetched
    return { expiresInSeconds: 24 * 60 * 60, token: data.authToken };
  });

  return {
    async send(tokens, { body, title }) {
      const invalidTokens: string[] = [];
      for (const regId of tokens) {
        const response = await fetch(`${API}/message/send`, {
          body: JSON.stringify({
            category,
            // A system message: something the user has to act on, not marketing
            classification: 1,
            content: clip(body, MAX_CONTENT),
            notifyType: 4,
            regId,
            requestId: randomUUID(),
            // Tapping opens the app
            skipType: 1,
            title: clip(title, MAX_TITLE),
          }),
          headers: { 'Content-Type': 'application/json', 'authToken': await authToken.get() },
          method: 'POST',
        });
        const data: {
          desc?: string;
          invalidUser?: { status?: number };
          result?: number;
        } = await response.json().catch(() => ({}));
        if (data.invalidUser?.status !== undefined && GONE_STATUSES.has(data.invalidUser.status)) {
          invalidTokens.push(regId);
          continue;
        }
        if (data.result !== 0) {
          throw new VendorPushError('vivo', `${data.result ?? response.status} ${data.desc ?? ''}`);
        }
      }
      return { invalidTokens };
    },
  };
};
