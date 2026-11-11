import type { MessengerPlatformDefinition } from '../types';
import { MessengerLarkBinder } from './binder';
import { larkWebhookGate } from './webhook';

export const lark: MessengerPlatformDefinition = {
  // Lark posts events for every installed tenant to one request URL.
  connectionMode: 'webhook',
  createBinder: (creds) => new MessengerLarkBinder(creds),
  id: 'lark',
  name: 'Lark',
  webhookGate: larkWebhookGate,
};
