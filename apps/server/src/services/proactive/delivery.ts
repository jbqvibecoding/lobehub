import debug from 'debug';

import { NotificationModel } from '@/database/models/notification';
import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import type { ProactiveMessageKind } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { PushChannel } from '../push/PushChannel';

const log = debug('lobe-server:proactive:delivery');

/**
 * The phone's notification category for anything Biber sends unprompted: a "Not now" button that
 * tells Biber the user did not want it, without opening the app.
 */
export const PROACTIVE_PUSH_CATEGORY = 'proactive';

/** What the phone opens on a tap: a routine's task, or the chat the message was written into. */
export type ProactivePushTarget = { taskId: string } | { agentId?: string; topicId: string };

export interface ProactiveDelivery {
  /** Web inbox link, e.g. the task page or the chat */
  actionUrl?: string;
  agentId?: string;
  briefId?: string;
  content: string;
  /** One delivery per key: a retried run or a second tick does not notify twice */
  dedupeKey: string;
  kind: ProactiveMessageKind;
  /** What the ledger keeps as the message's title when it differs from the push title */
  ledgerTitle?: string;
  messageId?: string;
  routineId?: string;
  target: ProactivePushTarget;
  taskId?: string;
  thoughtId?: string;
  title: string;
  topicId?: string;
}

/**
 * Sends one unprompted message to the user's phones and enters it in the results ledger, so its
 * open, dismissal or silence can be counted. Returns the ledger entry, or undefined when the same
 * delivery was already made.
 */
export const deliverProactiveMessage = async (
  db: LobeChatDatabase,
  userId: string,
  delivery: ProactiveDelivery,
  push: Pick<PushChannel, 'deliver'> = new PushChannel(),
) => {
  const notifications = new NotificationModel(db, userId);
  const notification = await notifications.create({
    actionUrl: delivery.actionUrl,
    category: 'agent',
    content: delivery.content,
    dedupeKey: delivery.dedupeKey,
    title: delivery.title,
    type: delivery.kind === 'routine' ? 'routine_result' : 'proactive_message',
  });
  if (!notification) {
    log('already delivered: %s', delivery.dedupeKey);
    return;
  }

  const outcome = await new ProactiveMessageModel(db, userId).record({
    agentId: delivery.agentId,
    briefId: delivery.briefId,
    kind: delivery.kind,
    messageId: delivery.messageId,
    notificationId: notification.id,
    routineId: delivery.routineId,
    taskId: delivery.taskId,
    thoughtId: delivery.thoughtId,
    title: delivery.ledgerTitle ?? delivery.title,
    topicId: delivery.topicId,
  });

  const result = await push.deliver({
    actionUrl: delivery.actionUrl,
    categoryId: PROACTIVE_PUSH_CATEGORY,
    content: delivery.content,
    data: {
      kind: delivery.kind === 'routine' ? 'routine' : 'proactive',
      outcomeId: outcome.id,
      ...(delivery.target as Record<string, string>),
    },
    notificationId: notification.id,
    title: delivery.title,
    userId,
  });

  log('%s %s: push %s %s', delivery.kind, outcome.id, result.status, result.failedReason ?? '');

  if (result.failedReason !== 'no_tokens') {
    await notifications.createDelivery({
      channel: 'push',
      failedReason: result.failedReason,
      notificationId: notification.id,
      providerMessageId: result.providerMessageId,
      sentAt: result.status === 'sent' ? new Date() : undefined,
      status: result.status,
    });
  }

  return outcome;
};

/**
 * Brings a starter routine's result to the phone: the routine's name as the title (the user's
 * language, set when they turned it on) and the brief's title as the text. Tapping it opens the
 * routine's task. Routines run when the user asked them to, so quiet hours and the daily budget
 * for unprompted messages do not apply.
 */
export const deliverRoutineResult = async (
  db: LobeChatDatabase,
  userId: string,
  {
    brief,
    task,
  }: {
    brief: { id: string; title: string };
    task: {
      assigneeAgentId?: string | null;
      context?: unknown;
      id: string;
      identifier: string;
      name?: string | null;
    };
  },
  push?: Pick<PushChannel, 'deliver'>,
) => {
  const routineId = (task.context as { starterRoutine?: string } | null)?.starterRoutine;
  if (!routineId) return;

  return deliverProactiveMessage(
    db,
    userId,
    {
      actionUrl: `/task/${task.identifier}`,
      agentId: task.assigneeAgentId ?? undefined,
      briefId: brief.id,
      content: brief.title,
      dedupeKey: `routine:${brief.id}`,
      kind: 'routine',
      routineId,
      target: { taskId: task.id },
      taskId: task.id,
      title: task.name || task.identifier,
    },
    push,
  );
};
