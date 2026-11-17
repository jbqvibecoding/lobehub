import type { MessengerLarkConfig } from '@/config/messenger';

import type { InboundCallbackAction } from '../../types';
import type { LarkEventBody } from './events';
import { getLarkTenantAccessToken } from './tokens';

/**
 * Approval requests in Lark and Feishu are interactive cards: the request as text, and a row of
 * Approve / Reject buttons per waiting call. A tap reaches the webhook as a `card.action.trigger`
 * callback carrying the button's `value`, and the reply to that callback replaces the card, so an
 * answered card keeps only its outcome.
 *
 * Text goes in as `plain_text`, never `lark_md`: it holds tool arguments, which must not render
 * as links or formatting.
 */

const API_BASE: Record<MessengerLarkConfig['platform'], string> = {
  feishu: 'https://open.feishu.cn/open-apis',
  lark: 'https://open.larksuite.com/open-apis',
};

/** `config.update_multi` makes the card one shared card, so an answer updates it for everyone. */
const card = (elements: object[]) => ({ config: { update_multi: true }, elements });

const textBlock = (content: string) => ({ tag: 'div', text: { content, tag: 'plain_text' } });

const button = (label: string, type: 'danger' | 'primary', action: string) => ({
  tag: 'button',
  text: { content: label, tag: 'plain_text' },
  type,
  value: { action },
});

export const buildApprovalCard = ({
  approvals,
  labels,
  text,
}: {
  approvals: { toolMessageId: string }[];
  labels: { approve: string; reject: string };
  text: string;
}) => {
  const numbered = approvals.length > 1;
  return card([
    textBlock(text),
    ...approvals.map(({ toolMessageId }, index) => {
      const suffix = numbered ? ` ${index + 1}` : '';
      return {
        actions: [
          button(`${labels.approve}${suffix}`, 'primary', `messenger:approve:${toolMessageId}`),
          button(`${labels.reject}${suffix}`, 'danger', `messenger:reject:${toolMessageId}`),
        ],
        tag: 'action',
      };
    }),
  ]);
};

/** What an answered card turns into: its outcome, without buttons. */
export const buildAnsweredCard = (text: string) => card([textBlock(text)]);

/**
 * Reads a button tap from an authenticated, decrypted delivery. Only our own buttons count
 * (`value.action` starting with `messenger:`); anything else is left to the message path.
 */
export const readCardAction = (body: LarkEventBody): InboundCallbackAction | null => {
  if (body.header?.event_type !== 'card.action.trigger') return null;

  const event = body.event ?? {};
  const data = event.action?.value?.action;
  const fromUserId = event.operator?.open_id;
  if (typeof data !== 'string' || !data.startsWith('messenger:') || !fromUserId) return null;

  // No `messageId`: the card is replaced through the callback's reply, so the resumed run posts
  // its answer as a new message rather than trying to edit a card into text.
  return {
    callbackId: String(event.token ?? ''),
    chatId: String(event.context?.open_chat_id ?? ''),
    data,
    fromUserId,
  };
};

/** Sends a card to a chat with this tenant's token. */
export const sendLarkCard = async (
  config: MessengerLarkConfig,
  tenantKey: string,
  chatId: string,
  content: object,
): Promise<void> => {
  const token = await getLarkTenantAccessToken(config, tenantKey);
  const response = await fetch(
    `${API_BASE[config.platform]}/im/v1/messages?receive_id_type=chat_id`,
    {
      body: JSON.stringify({
        content: JSON.stringify(content),
        msg_type: 'interactive',
        receive_id: chatId,
      }),
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  const data = (await response.json().catch(() => ({}))) as { code?: number; msg?: string };
  if (!response.ok || data.code !== 0) {
    throw new Error(`Lark card send failed: ${response.status} ${data.code} ${data.msg}`);
  }
};
