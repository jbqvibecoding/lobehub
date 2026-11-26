import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { NotificationModel } from '@/database/models/notification';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { toolApprovalDedupeKey } from '@/server/services/approvalNotification';
import { botTopicWebhookBody, buildBotDeliveryHooks } from '@/server/services/bot/deliveryHooks';
import { GithubConnectionService } from '@/server/services/githubApp';
import {
  ASK_USER_API_NAME,
  HETERO_TOOL_IDENTIFIER,
  type HeteroAnswer,
  PUSH_CHANGES_API_NAME,
  sendHeteroAnswer,
} from '@/server/services/heterogeneousAgent/interventions';
import { createTaskRunHooks } from '@/server/services/task/runHooks';

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
  /** The user's answer to a Claude Code question (`askUserQuestion`), with `approved` */
  answer?: HeteroAnswer;
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
    answer,
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

  // A Claude Code call waits in its sandbox: the answer goes to that run, no new run starts
  if (plugin.identifier === HETERO_TOOL_IDENTIFIER) {
    const operationId = plugin.intervention?.operationId;
    if (!operationId) throw new ToolApprovalError('BAD_REQUEST', 'This call has no run waiting');
    if (decision === 'approved' && plugin.apiName === ASK_USER_API_NAME && !answer) {
      throw new ToolApprovalError('BAD_REQUEST', 'A question needs an answer');
    }
    if (!(await messageModel.claimPendingIntervention(toolMessageId, decision))) {
      throw new ToolApprovalError('CONFLICT', 'This tool call was already answered');
    }
    log('answering %s of run %s (%s via %s)', toolMessageId, operationId, decision, via);
    if (plugin.apiName === PUSH_CHANGES_API_NAME) {
      // The push itself happens here, on approval, exactly as it was shown; the run learns how
      // it went from the answer
      const github = new GithubConnectionService(db, userId);
      if (decision === 'rejected') {
        await github.declinePush(plugin.toolCallId);
        await sendHeteroAnswer({ decision, operationId, reason, toolCallId: plugin.toolCallId });
      } else {
        try {
          const pushed = await github.push(plugin.toolCallId);
          await sendHeteroAnswer({
            answer: pushed,
            decision,
            operationId,
            toolCallId: plugin.toolCallId,
          });
        } catch (error) {
          log('push of %s failed: %O', toolMessageId, error);
          await sendHeteroAnswer({
            decision: 'rejected',
            operationId,
            reason: `The push failed: ${(error as Error).message}`,
            toolCallId: plugin.toolCallId,
          });
        }
      }
    } else {
      await sendHeteroAnswer({
        answer,
        decision,
        operationId,
        reason,
        toolCallId: plugin.toolCallId,
      });
    }
    // Answered: its "needs you" notification is done with, on every device
    await new NotificationModel(db, userId)
      .markAsReadByDedupeKeys([toolApprovalDedupeKey(plugin.toolCallId)])
      .catch((error) => log('clearing the notification of %s failed: %O', toolMessageId, error));
    return { operationId };
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
    // A run resumed after an approval settles the task too: the run that paused ended without it
    ...(task
      ? createTaskRunHooks({
          db,
          taskId: task.id,
          taskIdentifier: task.identifier,
          trigger: taskTopic?.trigger ?? 'manual',
          userId,
          workspaceId,
        })
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
