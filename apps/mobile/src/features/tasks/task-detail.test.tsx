import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';

import type { ApiClient } from '@/lib/api-client';

import { TaskDetailView } from './task-detail';
import type { TaskDetail } from './types';

const detail = (overrides: Partial<TaskDetail> = {}): TaskDetail => ({
  activities: [
    {
      id: 'a1',
      status: 'failed',
      summary: 'Portal was down',
      time: '2026-11-05T09:00:00Z',
      type: 'topic',
    },
    {
      content: 'Try again after 10am',
      createdAt: '2026-11-06T08:00:00Z',
      id: 'a2',
      type: 'comment',
    },
  ],
  error: 'The last run failed',
  identifier: 'T-7',
  instruction: 'Renew my passport online',
  name: 'Renew passport',
  status: 'failed',
  subtasks: [{ identifier: 'T-8', name: 'Upload photo', status: 'completed' }],
  ...overrides,
});

const renderDetail = async ({
  mutation = jest.fn(async () => ({})),
  responses,
}: {
  mutation?: jest.Mock;
  responses: TaskDetail[];
}) => {
  const query = jest.fn(async () => ({ data: responses.shift(), success: true }));
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}
    >
      <TaskDetailView api={{ mutation, query } as unknown as ApiClient} id="task-7" />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

describe('TaskDetailView', () => {
  it('shows where the task stands and its history, newest first', async () => {
    const { query } = await renderDetail({ responses: [detail()] });

    expect(await screen.findByRole('heading', { name: 'Renew passport' })).toBeOnTheScreen();
    expect(screen.getByText('The last run failed')).toBeOnTheScreen();
    expect(screen.getByText('T-8 Upload photo')).toBeOnTheScreen();
    expect(query).toHaveBeenCalledWith('task.detail', { id: 'task-7' });

    const [newest, oldest] = screen.getAllByText(/Try again after 10am|Portal was down/);
    expect(newest).toHaveTextContent('Try again after 10am');
    expect(oldest).toHaveTextContent('Portal was down');
  });

  it('runs it on request and shows the new state', async () => {
    const { mutation } = await renderDetail({
      responses: [detail(), detail({ error: null, status: 'running' })],
    });
    const user = userEvent.setup();

    await user.press(await screen.findByRole('button', { name: 'Run now' }));

    expect(mutation).toHaveBeenCalledWith('task.run', { id: 'task-7' });
    expect(await screen.findByText('Running')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeOnTheScreen();
  });

  it('keeps the button and says so when the task could not be started', async () => {
    await renderDetail({
      mutation: jest.fn(async () => {
        throw new Error('offline');
      }),
      responses: [detail(), detail()],
    });
    const user = userEvent.setup();

    await user.press(await screen.findByRole('button', { name: 'Run now' }));

    expect(await screen.findByText('Could not start the task. Try again.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled();
  });
});
