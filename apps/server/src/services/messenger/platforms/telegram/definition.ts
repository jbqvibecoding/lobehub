import type { MessengerPlatformDefinition } from '../types';
import { MessengerTelegramBinder } from './binder';
import { telegramWebhookGate } from './webhook';

export const telegram: MessengerPlatformDefinition = {
  // SystemBot Telegram is delivered via Bot API webhooks.
  connectionMode: 'webhook',
  createBinder: () => new MessengerTelegramBinder(),
  id: 'telegram',
  name: 'Telegram',
  webhookGate: telegramWebhookGate,
};
