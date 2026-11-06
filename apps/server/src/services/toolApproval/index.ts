import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { botTopicWebhookBody, buildBotDeliveryHooks } from '@/server/services/bot/deliveryHooks';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

const log = debug('lobe-server:tool-approval');

export type ToolApprovalDecision = 'approved' | 'rejected';

/** Why an answer was refused; maps onto the caller's own error codes (tRPC, chat toasts). */
export class ToolApprovalError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ToolApprovalError';
  }
}

interface AnswerToolApprovalParams {
  /**
   * The chat message that shows the request, when the answer came from that chat; the resumed
   * run edits it into its progress and reply instead of posting a new message.
   */
  chatMessageId?: string;
  decision: ToolApprovalDecision;
  /** Shown to the agent when the call is refused. */
  reason?: string;
  toolMessageId: string;
  userId: string;
  /** Where the user answered, e.g. `mobile` or `telegram`; kept in the agent action trail. */
  via: string;
  workspaceId?: string;
}

/**
 * Answers one pending tool call and resumes the paused run, wherever the answer comes from. Only
 * the first answer counts: a second device or a second tap gets CONFLICT. A run that came from a
 * chat (Telegram, Slack, ...) keeps reporting to that chat after it resumes.
 */
export const answerToolApproval = async (
  db: LobeChatDatabase,
  {
    chatMessageId,
    decision,
    reason,
    toolMessageId,
    userId,
    via,
    workspaceId,
  }: AnswerToolApprovalParams,
) => {
  const messageModel = new MessageModel(db, userId, workspaceId);
  const [plugin, message] = await Promise.all([
    messageModel.findMessagePlugin(toolMessageId),
    messageModel.findById(toolMessageId),
  ]);

  if (!plugin || !message || message.role !== 'tool' || !message.agentId) {
    throw new ToolApprovalError('NOT_FOUND', 'No such tool call');
  }
  if (!plugin.toolCallId) {
    throw new ToolApprovalError('BAD_REQUEST', 'This tool call has no id to resume');
  }
  if (!(await messageModel.claimPendingIntervention(toolMessageId, decision))) {
    throw new ToolApprovalError('CONFLICT', 'This tool call was already answered');
  }

  const topic = message.topicId
    ? await new TopicModel(db, userId, workspaceId).findById(message.topicId)
    : undefined;
  const bot = topic?.metadata?.bot;
  const reportToChat = !!bot && isQueueAgentRuntimeEnabled();

  log('answering %s (%s via %s), chat=%s', toolMessageId, decision, via, reportToChat);

  const result = await new AiAgentService(db, userId, { workspaceId }).execAgent({
    agentId: message.agentId,
    appContext: {
      groupId: message.groupId,
      threadId: message.threadId,
      topicId: message.topicId,
    },
    ...(bot && { botContext: bot }),
    ...(reportToChat && {
      hooks: buildBotDeliveryHooks({
        webhookBody: botTopicWebhookBody(bot, {
          progressMessageId: chatMessageId,
          userId,
          workspaceId,
        }),
      }),
    }),
    parentMessageId: toolMessageId,
    prompt: '',
    resume: true,
    resumeApproval: {
      decision,
      parentMessageId: toolMessageId,
      rejectionReason: reason,
      toolCallId: plugin.toolCallId,
      via,
    },
    trigger: bot ? RequestTrigger.Bot : RequestTrigger.Chat,
    // Later calls in the resumed run ask again rather than running unattended
    userInterventionConfig: { approvalMode: 'manual' },
  });

  return { operationId: result.operationId };
};
