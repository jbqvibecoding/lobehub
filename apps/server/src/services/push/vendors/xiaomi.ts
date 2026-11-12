import { inBatches, VendorPushError, type VendorPushSender } from './types';

const SEND_URL = 'https://api.xmpush.xiaomi.com/v3/message/regid';

/** Xiaomi accepts up to 1000 registration ids per request */
const MAX_TOKENS = 1000;

/** Xiaomi Push, for Xiaomi and Redmi phones. Requests carry the AppSecret itself. */
export const createXiaomiSender = ({
  appSecret,
  channelId,
  packageName,
}: {
  appSecret: string;
  /** The private-message channel registered with Xiaomi; public channels are capped per day */
  channelId?: string;
  packageName: string;
}): VendorPushSender => ({
  async send(tokens, { body, title }) {
    const invalidTokens: string[] = [];
    for (const batch of inBatches(tokens, MAX_TOKENS)) {
      const form = new URLSearchParams({
        'description': body,
        // Tapping opens the app's launcher activity
        'extra.notify_effect': '1',
        'notify_type': '-1',
        'pass_through': '0',
        'payload': '',
        'registration_id': batch.join(','),
        'restricted_package_name': packageName,
        title,
      });
      if (channelId) form.set('extra.channel_id', channelId);

      const response = await fetch(SEND_URL, {
        body: form,
        headers: { Authorization: `key=${appSecret}` },
        method: 'POST',
      });
      const data: {
        code?: number;
        data?: { bad_regids?: string; bad_regIds?: string };
        description?: string;
        reason?: string;
        result?: string;
      } = await response.json().catch(() => ({}));
      if (data.result !== 'ok' && data.code !== 0) {
        throw new VendorPushError(
          'xiaomi',
          `${data.code ?? response.status} ${data.reason ?? data.description ?? ''}`.trim(),
        );
      }
      const bad = data.data?.bad_regids ?? data.data?.bad_regIds;
      if (bad) invalidTokens.push(...bad.split(',').filter(Boolean));
    }
    return { invalidTokens };
  },
});
