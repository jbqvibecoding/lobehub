import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { ApiClient } from '@/lib/api-client';

import { TaskBoard } from './task-board';
import type { TaskGroup } from './types';

jest.mock('expo-router', () => ({ Link: ({ children }: { children: ReactNode }) => children }));

const task = (id: string, status: string, name: string, error?: string) => ({
  error,
  id,
  identifier: `T-${id}`,
  instruction: name,
  name,
  status,
});

const renderBoard = async (responses: (TaskGroup[] | Error)[]) => {
  const query = jest.fn(async () => {
    const next = responses.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no response');
    return { data: next, success: true };
  });
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}
    >
      <TaskBoard api={{ query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { query };
};

describe('TaskBoard', () => {
  it('asks for top-level tasks grouped like the web board, and shows what needs you first', async () => {
    const { query } = await renderBoard([
      [
        {
          hasMore: false,
          key: 'needsInput',
          tasks: [task('1', 'paused', 'Renew passport', 'Heartbeat timeout') as any],
          total: 1,
        },
        { hasMore: false, key: 'running', tasks: [], total: 0 },
        {
          hasMore: true,
          key: 'done',
          tasks: [task('2', 'completed', 'File taxes') as any],
          total: 25,
        },
      ],
    ]);

    expect(await screen.findByText('Renew passport')).toBeOnTheScreen();
    expect(screen.getByText('Heartbeat timeout')).toBeOnTheScreen();
    expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeOnTheScreen();
    expect(screen.getByRole('heading', { name: 'Done · 25' })).toBeOnTheScreen();
    expect(screen.queryByRole('heading', { name: /In progress/ })).not.toBeOnTheScreen();

    expect(query).toHaveBeenCalledWith('task.groupList', {
      groups: [
        { key: 'needsInput', limit: 20, statuses: ['paused', 'failed'] },
        { key: 'running', limit: 20, statuses: ['running', 'scheduled'] },
        { key: 'backlog', limit: 20, statuses: ['backlog'] },
        { key: 'done', limit: 20, statuses: ['completed'] },
      ],
      parentTaskId: null,
    });
  });

  it('says so when there are no tasks, and offers a retry when they cannot be loaded', async () => {
    await renderBoard([new Error('offline'), []]);
    const user = userEvent.setup();

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByText('No tasks yet. Tasks you or your agents create show up here.'),
    ).toBeOnTheScreen();
  });
});
