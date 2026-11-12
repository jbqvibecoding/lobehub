import { inBatches, tokenHolder, VendorPushError, type VendorPushSender } from './types';

const TOKEN_URL = 'https://iam.developer.hihonor.com/auth/token';
const SEND_URL = (appId: string) =>
  `https://push-api.cloud.hihonor.com/api/v1/${appId}/sendMessage`;

/** Honor accepts up to 1000 tokens per message */
const MAX_TOKENS = 1000;

/** Honor Push, for Honor phones (which no longer carry Huawei's services). */
export const createHonorSender = ({
  appId,
  clientId,
  clientSecret,
}: {
  appId: string;
  clientId: string;
  clientSecret: string;
}): VendorPushSender => {
  const accessToken = tokenHolder(async () => {
    const response = await fetch(TOKEN_URL, {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      method: 'POST',
    });
    const data: { access_token?: string; error_description?: string; expires_in?: number } =
      await response.json().catch(() => ({}));
    if (!data.access_token) {
      throw new VendorPushError('honor', `token: ${data.error_description ?? response.status}`);
    }
    return { expiresInSeconds: data.expires_in ?? 3600, token: data.access_token };
  });

  const sendBatch = async (tokens: string[], payload: object, retried = false) => {
    const response = await fetch(SEND_URL(appId), {
      body: JSON.stringify({ ...payload, token: tokens }),
      headers: {
        'Authorization': `Bearer ${await accessToken.get()}`,
        'Content-Type': 'application/json',
        'timestamp': String(Date.now()),
      },
      method: 'POST',
    });
    const data: {
      code?: number;
      data?: { expireTokens?: string[] };
      message?: string;
    } = await response.json().catch(() => ({}));

    if (response.status === 401 && !retried) {
      accessToken.clear();
      return sendBatch(tokens, payload, true);
    }
    if (data.code !== 200) {
      throw new VendorPushError('honor', `${data.code ?? response.status} ${data.message ?? ''}`);
    }
    return data.data?.expireTokens ?? [];
  };

  return {
    async send(tokens, { body, title }) {
      const payload = {
        android: { notification: { body, clickAction: { type: 3 }, title } },
      };
      const invalidTokens: string[] = [];
      for (const batch of inBatches(tokens, MAX_TOKENS)) {
        invalidTokens.push(...(await sendBatch(batch, payload)));
      }
      return { invalidTokens };
    },
  };
};
