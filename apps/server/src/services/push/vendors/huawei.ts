import { inBatches, tokenHolder, VendorPushError, type VendorPushSender } from './types';

const TOKEN_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const SEND_URL = (appId: string) => `https://push-api.cloud.huawei.com/v1/${appId}/messages:send`;

const SUCCESS = '80000000';
/** Some tokens were accepted; `msg` lists the rest as `illegal_tokens` */
const PARTIAL = '80100000';
/** None of the tokens is valid */
const ALL_TOKENS_INVALID = '80300007';
/** The OAuth access token expired or is wrong */
const AUTH_FAILED = '80200003';

/** Huawei accepts up to 1000 tokens per message */
const MAX_TOKENS = 1000;

/**
 * Huawei Push Kit (HMS), for Huawei phones. The AppGallery Connect app id doubles as the OAuth
 * client id.
 */
export const createHuaweiSender = ({
  appId,
  category,
  clientSecret,
}: {
  appId: string;
  /** A self-classification category Huawei granted, e.g. `WORK` */
  category?: string;
  clientSecret: string;
}): VendorPushSender => {
  const accessToken = tokenHolder(async () => {
    const response = await fetch(TOKEN_URL, {
      body: new URLSearchParams({
        client_id: appId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      method: 'POST',
    });
    const data: { access_token?: string; error_description?: string; expires_in?: number } =
      await response.json().catch(() => ({}));
    if (!data.access_token) {
      throw new VendorPushError('huawei', `token: ${data.error_description ?? response.status}`);
    }
    return { expiresInSeconds: data.expires_in ?? 3600, token: data.access_token };
  });

  const sendBatch = async (
    tokens: string[],
    payload: object,
    retried = false,
  ): Promise<string[]> => {
    const response = await fetch(SEND_URL(appId), {
      body: JSON.stringify({ message: { ...payload, token: tokens }, validate_only: false }),
      headers: {
        'Authorization': `Bearer ${await accessToken.get()}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const data: { code?: string; msg?: string } = await response.json().catch(() => ({}));

    if ((response.status === 401 || data.code === AUTH_FAILED) && !retried) {
      accessToken.clear();
      return sendBatch(tokens, payload, true);
    }
    if (data.code === SUCCESS) return [];
    if (data.code === ALL_TOKENS_INVALID) return tokens;
    if (data.code === PARTIAL) {
      try {
        return (JSON.parse(data.msg ?? '{}') as { illegal_tokens?: string[] }).illegal_tokens ?? [];
      } catch {
        return [];
      }
    }
    throw new VendorPushError('huawei', `${data.code ?? response.status} ${data.msg ?? ''}`.trim());
  };

  return {
    async send(tokens, { body, title }) {
      const payload = {
        android: {
          ...(category ? { category } : {}),
          notification: { body, click_action: { type: 3 }, title },
        },
      };
      const invalidTokens: string[] = [];
      for (const batch of inBatches(tokens, MAX_TOKENS)) {
        invalidTokens.push(...(await sendBatch(batch, payload)));
      }
      return { invalidTokens };
    },
  };
};
