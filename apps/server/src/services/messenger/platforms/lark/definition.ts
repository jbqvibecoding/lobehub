import type { MessengerPlatformDefinition } from '../types';
import { MessengerLarkBinder } from './binder';
import { larkWebhookGate } from './webhook';

export const lark: MessengerPlatformDefinition = {
  // Lark posts events for every installed tenant to one request URL.
  connectionMode: 'webhook',
  createBinder: (creds) => new MessengerLarkBinder('lark', creds),
  id: 'lark',
  name: 'Lark',
  webhookGate: larkWebhookGate('lark'),
};

/** The same store app on Feishu, Lark's China domain, for the mainland edition. */
export const feishu: MessengerPlatformDefinition = {
  connectionMode: 'webhook',
  createBinder: (creds) => new MessengerLarkBinder('feishu', creds),
  id: 'feishu',
  name: 'Feishu',
  webhookGate: larkWebhookGate('feishu'),
};
