import { isMessengerPlatformAvailable } from '@lobechat/region';

import { regionEnv } from '@/envs/region';

import { discord } from './discord';
import { imessage } from './imessage';
import { MessengerPlatformRegistry } from './registry';
import { slack } from './slack';
import { telegram } from './telegram';

export { MessengerDiscordBinder } from './discord';
export { MessengerImessageBinder } from './imessage';
export { MessengerPlatformRegistry } from './registry';
export { MessengerSlackBinder, slackWebhookGate } from './slack';
export { MessengerTelegramBinder } from './telegram';
export type {
  MessengerPlatformDefinition,
  MessengerPlatformWebhookGate,
  MessengerWebhookContext,
  SerializedMessengerPlatformDefinition,
} from './types';

/**
 * Singleton registry — one per process. Each platform definition lives
 * alongside its binder + (optional) webhook gate, mirroring `bot/platforms/`.
 */
export const messengerPlatformRegistry = new MessengerPlatformRegistry();

// None of the product-owned messenger bots is reachable from the mainland edition.
for (const definition of [slack, telegram, discord, imessage]) {
  if (isMessengerPlatformAvailable(regionEnv.APP_REGION, definition.id)) {
    messengerPlatformRegistry.register(definition);
  }
}
