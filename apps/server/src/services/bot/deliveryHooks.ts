import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicBotContext } from '@lobechat/types';
import debug from 'debug';

import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import type { BotCallbackBody } from './BotCallbackService';

const log = debug('lobe-server:bot:delivery-hooks');

export const BOT_CALLBACK_URL = '/api/agent/webhooks/bot-callback';

/**
 * Hands a bot run's step or completion to `BotCallbackService` in this process, as the bot
 * callback webhook does in queue mode. Local mode has no webhook delivery: hooks only call their
 * handlers, so this is how a local run reports to its chat.
 */
export const deliverBotCallbackInProcess = async (
  db: LobeChatDatabase,
  event: object,
  body: Record<string, unknown>,
) => {
  const { finalState: _finalState, ...fields } = event as Record<string, unknown>;
  // Imported here because BotCallbackService imports AgentBridgeService, which imports this module
  const { BotCallbackService } = await import('./BotCallbackService');
  await new BotCallbackService(db).handleCallback({ ...fields, ...body } as BotCallbackBody);
};

/** Queue mode delivers by webhook; local mode calls the handler, which delivers in process. */
const deliverLocally =
  (db: LobeChatDatabase, body: Record<string, unknown>) => async (event: object) => {
    if (isQueueAgentRuntimeEnabled()) return;
    try {
      await deliverBotCallbackInProcess(db, event, body);
    } catch (error) {
      log('in-process %s delivery failed: %O', body.type, error);
    }
  };

/**
 * Reports a bot run back to its chat: progress after each step, and on completion the reply, or
 * the approval request when the run paused for the user (`reason: 'waiting_for_human'`).
 * `webhookBody` identifies the chat (see `BotCallbackBody`).
 */
export const buildBotDeliveryHooks = ({
  db,
  userPrompt,
  webhookBody,
}: {
  db: LobeChatDatabase;
  userPrompt?: string;
  webhookBody: Record<string, unknown>;
}): AgentHook[] => {
  const step = { ...webhookBody, type: 'step' };
  const completion = { ...webhookBody, type: 'completion', userPrompt };
  return [
    {
      handler: deliverLocally(db, step),
      id: 'bot-step-progress',
      type: 'afterStep',
      webhook: { body: step, delivery: 'qstash', url: BOT_CALLBACK_URL },
    },
    {
      handler: deliverLocally(db, completion),
      id: 'bot-completion',
      type: 'onComplete',
      webhook: { body: completion, delivery: 'qstash', url: BOT_CALLBACK_URL },
    },
  ];
};

/**
 * The chat a bot topic belongs to, for a run that did not start from a chat message (e.g. one
 * resumed by an approval). `progressMessageId` is the chat message to turn into the reply.
 */
export const botTopicWebhookBody = (
  bot: ChatTopicBotContext,
  {
    progressMessageId,
    userId,
    workspaceId,
  }: { progressMessageId?: string; userId: string; workspaceId?: string },
) => ({
  applicationId: bot.applicationId,
  messengerInstallationKey: bot.messengerInstallationKey,
  isOwner: bot.isOwner,
  platformThreadId: bot.platformThreadId,
  progressMessageId,
  userId,
  workspaceId,
});
