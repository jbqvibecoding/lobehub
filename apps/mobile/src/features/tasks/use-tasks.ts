import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiClient } from '@/lib/api-client';

import type { TaskDetail, TaskGroup } from './types';

/** The web board's groups, minus canceled tasks, with what needs the user first. */
export const TASK_GROUPS = [
  { key: 'needsInput', statuses: ['paused', 'failed'] },
  { key: 'running', statuses: ['running', 'scheduled'] },
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'done', statuses: ['completed'] },
] as const;

const PER_GROUP = 20;

export const taskBoardKey = ['tasks', 'board'] as const;
export const taskDetailKey = (id: string) => ['tasks', 'detail', id] as const;

/** Top-level tasks; subtasks show on their parent's page. */
export const useTaskBoard = (api: ApiClient) =>
  useQuery({
    queryFn: async () => {
      const result = (await api.query('task.groupList', {
        groups: TASK_GROUPS.map(({ key, statuses }) => ({
          key,
          limit: PER_GROUP,
          statuses: [...statuses],
        })),
        parentTaskId: null,
      })) as { data: TaskGroup[] };
      return result.data;
    },
    queryKey: taskBoardKey,
  });

export const useTaskDetail = (api: ApiClient, id: string) =>
  useQuery({
    queryFn: async () => ((await api.query('task.detail', { id })) as { data: TaskDetail }).data,
    queryKey: taskDetailKey(id),
  });

export const useRunTask = (api: ApiClient, id: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.mutation('task.run', { id }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: taskDetailKey(id) }),
        queryClient.invalidateQueries({ queryKey: taskBoardKey }),
      ]),
  });
};
