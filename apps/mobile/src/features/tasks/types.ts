export type TaskStatus =
  'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running' | 'scheduled';

/** A task as `task.groupList` returns it (a `tasks` row on the server). */
export interface TaskSummary {
  /** Why a paused or failed task stopped. */
  error?: string | null;
  id: string;
  /** What people call it, e.g. `T-12`. */
  identifier: string;
  instruction: string;
  name?: string | null;
  status: TaskStatus;
}

export type TaskGroupKey = 'backlog' | 'done' | 'needsInput' | 'running';

export interface TaskGroup {
  hasMore: boolean;
  key: TaskGroupKey;
  tasks: TaskSummary[];
  total: number;
}

/** One entry of a task's history: a run, an agent's report, a comment, or its creation. */
export interface TaskActivity {
  /** Runs: when the run ended. */
  completedAt?: string;
  content?: string;
  createdAt?: string;
  id?: string;
  /** Runs: `running`, `completed`, `failed`, `canceled` or `timeout`. */
  status?: string | null;
  summary?: string;
  /** Runs: when the run started. */
  time?: string;
  title?: string;
  type: 'brief' | 'comment' | 'created' | 'topic';
}

/** What `task.detail` returns, as far as the phone shows it. */
export interface TaskDetail {
  activities?: TaskActivity[];
  error?: string | null;
  identifier: string;
  instruction: string;
  name?: string | null;
  status: TaskStatus;
  subtasks?: { identifier: string; name?: string | null; status: TaskStatus }[];
}
