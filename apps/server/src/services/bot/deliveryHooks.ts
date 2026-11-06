import type { ChatTopicBotContext } from '@lobechat/types';

import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';

export const BOT_CALLBACK_URL = '/api/agent/webhooks/bot-callback';

/** Queue mode delivers by webhook; these handlers only exist to satisfy the hook shape. */
const deliveredByWebhook = async () => {};

/**
 * The webhooks that report a queue-mode bot run back to its chat: progress after each step, and
 * on completion the reply, or the approval request when the run paused for the user
 * (`reason: 'waiting_for_human'`). `webhookBody` identifies the chat (see `BotCallbackBody`).
 */
export const buildBotDeliveryHooks = ({
  userPrompt,
  webhookBody,
}: {
  userPrompt?: string;
  webhookBody: Record<string, unknown>;
}): AgentHook[] => [
  {
    handler: deliveredByWebhook,
    id: 'bot-step-progress',
    type: 'afterStep',
    webhook: {
      body: { ...webhookBody, type: 'step' },
      delivery: 'qstash',
      url: BOT_CALLBACK_URL,
    },
  },
  {
    handler: deliveredByWebhook,
    id: 'bot-completion',
    type: 'onComplete',
    webhook: {
      body: { ...webhookBody, type: 'completion', userPrompt },
      delivery: 'qstash',
      url: BOT_CALLBACK_URL,
    },
  },
];

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
