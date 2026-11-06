import { type StringKey, t } from '@/i18n/strings';

import type { TaskActivity, TaskGroupKey, TaskStatus, TaskSummary } from './types';

const MAX_TITLE_LENGTH = 80;

export type TaskTone = 'done' | 'idle' | 'problem' | 'working';

/** Task statuses, plus `timeout`, which only a run can end with. */
const STATUS: Record<TaskStatus | 'timeout', { key: StringKey; tone: TaskTone }> = {
  backlog: { key: 'taskStatusBacklog', tone: 'idle' },
  canceled: { key: 'taskStatusCanceled', tone: 'idle' },
  completed: { key: 'taskStatusCompleted', tone: 'done' },
  failed: { key: 'taskStatusFailed', tone: 'problem' },
  paused: { key: 'taskStatusPaused', tone: 'problem' },
  running: { key: 'taskStatusRunning', tone: 'working' },
  scheduled: { key: 'taskStatusScheduled', tone: 'working' },
  timeout: { key: 'taskStatusTimedOut', tone: 'problem' },
};

const GROUP_TITLES: Record<TaskGroupKey, StringKey> = {
  backlog: 'taskGroupBacklog',
  done: 'taskGroupDone',
  needsInput: 'taskGroupNeedsInput',
  running: 'taskGroupRunning',
};

const ACTIVITY_LABELS: Record<TaskActivity['type'], StringKey> = {
  brief: 'taskActivityBrief',
  comment: 'taskActivityComment',
  created: 'taskActivityCreated',
  topic: 'taskActivityRun',
};

/** Unknown statuses (a newer server) read as their raw name rather than breaking the screen. */
export const describeStatus = (status: string) => {
  const known = STATUS[status as keyof typeof STATUS];
  return known
    ? { label: t(known.key), tone: known.tone }
    : { label: status, tone: 'idle' as const };
};

export const groupTitle = (key: TaskGroupKey) => t(GROUP_TITLES[key]);

/** A task's name, or the first line of what it was asked to do. */
export const taskTitle = (task: Pick<TaskSummary, 'instruction' | 'name'>) => {
  const title = task.name?.trim() || task.instruction.split('\n', 1)[0].trim();
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
};

/** A task that is not already running or waiting for its next scheduled run can be started. */
export const canRunNow = (status: TaskStatus) => status !== 'running' && status !== 'scheduled';

/** One history entry: what it was, its outcome for runs, its text, and when. */
export const describeActivity = (activity: TaskActivity) => {
  const when = activity.time ?? activity.createdAt;

  return {
    label: t(ACTIVITY_LABELS[activity.type] ?? 'taskActivityComment'),
    status:
      activity.type === 'topic' && activity.status ? describeStatus(activity.status) : undefined,
    text: activity.summary || activity.title || activity.content || undefined,
    when: when ? new Date(when) : undefined,
  };
};
