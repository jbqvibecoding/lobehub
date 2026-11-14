import type { TaskRunTrigger } from '@lobechat/types';

import type { TaskLifecycleService } from '@/server/services/taskLifecycle';

/**
 * The hook that settles a task when a run of it ends: status, briefs, the next scheduled tick, and
 * the result handed back to whoever created the task. A run resumed after an approval carries it
 * too (`answerToolApproval`), since the run that paused ended without settling anything.
 */
export const taskCompletionHook = ({
  runTrigger,
  taskId,
  taskIdentifier,
  taskLifecycle,
  userId,
}: {
  runTrigger: TaskRunTrigger;
  taskId: string;
  taskIdentifier: string;
  taskLifecycle: TaskLifecycleService;
  userId: string;
}) => ({
  handler: async (event: {
    errorMessage?: string;
    lastAssistantContent?: string;
    operationId: string;
    reason?: string;
    topicId?: string;
  }) => {
    await taskLifecycle.onTopicComplete({
      errorMessage: event.errorMessage,
      lastAssistantContent: event.lastAssistantContent,
      operationId: event.operationId,
      reason: event.reason || 'done',
      runTrigger,
      taskId,
      taskIdentifier,
      topicId: event.topicId,
    });
  },
  id: 'task-on-complete',
  type: 'onComplete' as const,
  webhook: {
    // `runTrigger` rides in the static body so the production webhook callback (which reconstructs
    // onTopicComplete params server-side) knows whether this was a manual run or an automation tick.
    body: { runTrigger, taskId, taskIdentifier, userId },
    delivery: 'qstash' as const,
    url: '/api/workflows/task/on-topic-complete',
  },
});
