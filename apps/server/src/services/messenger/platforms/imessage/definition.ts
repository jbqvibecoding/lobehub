import type { MessengerPlatformDefinition } from '../types';
import { MessengerImessageBinder } from './binder';
import { LINQ_ADAPTER_NAME } from './client';
import { imessageWebhookGate } from './webhook';

export const imessage: MessengerPlatformDefinition = {
  adapterName: LINQ_ADAPTER_NAME,
  // Linq posts every inbound message to our webhook.
  connectionMode: 'webhook',
  createBinder: () => new MessengerImessageBinder(),
  id: 'imessage',
  name: 'iMessage',
  webhookGate: imessageWebhookGate,
};
