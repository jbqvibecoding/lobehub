import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { botTopicWebhookBody, buildBotDeliveryHooks } from '@/server/services/bot/deliveryHooks';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { taskCompletionHook } from '@/server/services/taskRunner/completionHook';

import { backgroundInterventionConfig } from './background';

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
  // A run of a task paused without settling the task; the resumed run settles it when it ends
  const taskTopic = message.topicId
    ? await new TaskTopicModel(db, userId, workspaceId).findByTopicId(message.topicId)
    : null;
  const task = taskTopic
    ? await new TaskModel(db, userId, workspaceId).findById(taskTopic.taskId)
    : null;

  log('answering %s (%s via %s), chat=%s task=%s', toolMessageId, decision, via, !!bot, task?.id);

  const hooks = [
    ...(bot
      ? buildBotDeliveryHooks({
          db,
          webhookBody: botTopicWebhookBody(bot, {
            progressMessageId: chatMessageId,
            userId,
            workspaceId,
          }),
        })
      : []),
    ...(task
      ? [
          taskCompletionHook({
            runTrigger: taskTopic?.trigger ?? 'manual',
            taskId: task.id,
            taskIdentifier: task.identifier,
            taskLifecycle: new TaskLifecycleService(db, userId, workspaceId),
            userId,
          }),
        ]
      : []),
  ];

  const result = await new AiAgentService(db, userId, { workspaceId }).execAgent({
    agentId: message.agentId,
    appContext: {
      groupId: message.groupId,
      threadId: message.threadId,
      topicId: message.topicId,
    },
    ...(bot && { botContext: bot }),
    ...(hooks.length > 0 && { hooks }),
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
    // Later calls in the resumed run ask again rather than running unattended; a task's run keeps
    // the rules of a run nobody is watching
    userInterventionConfig: task
      ? await backgroundInterventionConfig(db, userId)
      : { approvalMode: 'manual' },
  });

  // Stopping the task stops its current operation, which is now the resumed one
  if (task && message.topicId && result.operationId) {
    await new TaskTopicModel(db, userId, workspaceId).updateOperationId(
      task.id,
      message.topicId,
      result.operationId,
    );
  }

  return { operationId: result.operationId };
};
