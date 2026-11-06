import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import type { ApiClient } from '@/lib/api-client';

import { ActivityList } from './activity-list';
import type { ActivityEvent, ActivityPage } from './types';

const event = (id: string, apiName: string): ActivityEvent => ({
  apiName,
  createdAt: new Date('2026-11-06T09:00:00Z'),
  eventType: 'succeeded',
  id,
  identifier: 'gmail-mcp',
  payload: {},
});

const renderList = async (pages: (ActivityPage | Error)[]) => {
  const query = jest.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error('no more pages');
    if (next instanceof Error) throw next;
    return next;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={queryClient}>
      <ActivityList api={{ query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { query };
};

describe('ActivityList', () => {
  it('shows events and loads older ones at the end of the list', async () => {
    const { query } = await renderList([
      { items: [event('event-2', 'send_email')], nextCursor: 'event-2' },
      { items: [event('event-1', 'archive_thread')] },
    ]);

    expect(await screen.findByText('Send email · gmail-mcp')).toBeOnTheScreen();

    await fireEvent(screen.getByTestId('activity-list'), 'onEndReached');

    expect(await screen.findByText('Archive thread · gmail-mcp')).toBeOnTheScreen();
    expect(query).toHaveBeenLastCalledWith('activity.list', { cursor: 'event-2' });
  });

  it('says so when nothing happened yet', async () => {
    await renderList([{ items: [] }]);

    expect(
      await screen.findByText(
        'Nothing yet. What agents do for you, and what you approve, shows up here.',
      ),
    ).toBeOnTheScreen();
  });

  it('offers a retry when the trail cannot be loaded', async () => {
    await renderList([new Error('offline'), { items: [event('event-1', 'send_email')] }]);
    const user = userEvent.setup();

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Send email · gmail-mcp')).toBeOnTheScreen();
  });
});
