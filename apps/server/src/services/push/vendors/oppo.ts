import { createHash } from 'node:crypto';

import { inBatches, tokenHolder, VendorPushError, type VendorPushSender } from './types';

const API = 'https://api.push.oppomobile.com/server/v1';

/** The auth token is wrong or expired */
const AUTH_INVALID = 11;
/** The registration id is not valid for this app */
const INVALID_REGISTRATION = 10_000;

/** OPPO accepts up to 1000 messages per batch */
const MAX_TOKENS = 1000;

/** OPPO Push (HeyTap), for OPPO, OnePlus and realme phones. */
export const createOppoSender = ({
  appKey,
  channelId,
  masterSecret,
}: {
  appKey: string;
  /** The private-message channel created in OPPO's console */
  channelId?: string;
  masterSecret: string;
}): VendorPushSender => {
  const authToken = tokenHolder(async () => {
    const timestamp = String(Date.now());
    const response = await fetch(`${API}/auth`, {
      body: new URLSearchParams({
        app_key: appKey,
        sign: createHash('sha256').update(`${appKey}${timestamp}${masterSecret}`).digest('hex'),
        timestamp,
      }),
      method: 'POST',
    });
    const data: { code?: number; data?: { auth_token?: string }; message?: string } = await response
      .json()
      .catch(() => ({}));
    if (data.code !== 0 || !data.data?.auth_token) {
      throw new VendorPushError(
        'oppo',
        `auth: ${data.code ?? response.status} ${data.message ?? ''}`,
      );
    }
    // Valid for a day
    return { expiresInSeconds: 24 * 60 * 60, token: data.data.auth_token };
  });

  const sendBatch = async (
    tokens: string[],
    notification: object,
    retried = false,
  ): Promise<string[]> => {
    const messages = tokens.map((token) => ({
      notification,
      target_type: 2,
      target_value: token,
    }));
    const response = await fetch(`${API}/message/notification/unicast_batch`, {
      body: new URLSearchParams({ messages: JSON.stringify(messages) }),
      headers: { auth_token: await authToken.get() },
      method: 'POST',
    });
    const data: {
      code?: number;
      data?: { errorCode?: number; registrationId?: string }[];
      message?: string;
    } = await response.json().catch(() => ({}));

    if (data.code === AUTH_INVALID && !retried) {
      authToken.clear();
      return sendBatch(tokens, notification, true);
    }
    if (data.code !== 0) {
      throw new VendorPushError('oppo', `${data.code ?? response.status} ${data.message ?? ''}`);
    }
    return (data.data ?? [])
      .filter((item) => item.errorCode === INVALID_REGISTRATION && item.registrationId)
      .map((item) => item.registrationId!);
  };

  return {
    async send(tokens, { body, title }) {
      const notification = {
        // Tapping opens the app
        click_action_type: 0,
        content: body,
        style: 1,
        title,
        ...(channelId ? { channel_id: channelId } : {}),
      };
      const invalidTokens: string[] = [];
      for (const batch of inBatches(tokens, MAX_TOKENS)) {
        invalidTokens.push(...(await sendBatch(batch, notification)));
      }
      return { invalidTokens };
    },
  };
};
