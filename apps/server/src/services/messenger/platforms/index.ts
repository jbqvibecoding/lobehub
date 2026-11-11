import { isMessengerPlatformAvailable } from '@lobechat/region';

import { regionEnv } from '@/envs/region';

import { discord } from './discord';
import { imessage } from './imessage';
import { feishu, lark } from './lark';
import { MessengerPlatformRegistry } from './registry';
import { slack } from './slack';
import { telegram } from './telegram';

export { MessengerDiscordBinder } from './discord';
export { MessengerImessageBinder } from './imessage';
export { MessengerLarkBinder } from './lark';
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

// The mainland edition offers only the bots reachable from mainland China (see @lobechat/region).
for (const definition of [slack, telegram, discord, imessage, lark, feishu]) {
  if (isMessengerPlatformAvailable(regionEnv.APP_REGION, definition.id)) {
    messengerPlatformRegistry.register(definition);
  }
}
