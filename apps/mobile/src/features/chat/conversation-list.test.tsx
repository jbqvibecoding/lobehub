import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import type { ApiClient } from '@/lib/api-client';

import { ConversationList } from './conversation-list';
import type { RecentConversation } from './types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-router', () => {
  const { forwardRef } = jest.requireActual('react');
  return {
    Link: forwardRef(({ children }: { children: unknown }, _ref: unknown) => children),
  };
});

const renderList = async (query: jest.Mock) => {
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}
    >
      <ConversationList api={{ query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
};

describe('ConversationList', () => {
  it("lists recent chats with each agent's name, leaving out group chats", async () => {
    const conversations: RecentConversation[] = [
      {
        agent: { id: 'agent-1', title: 'Biber' },
        id: 'topic-1',
        title: 'Plan the trip',
        type: 'agent',
        updatedAt: new Date('2025-01-01T09:00:00Z'),
      },
      {
        agent: null,
        id: 'topic-2',
        title: 'Team standup',
        type: 'group',
        updatedAt: new Date('2025-01-01T08:00:00Z'),
      },
    ];
    const query = jest.fn(async () => conversations);

    await renderList(query);

    expect(await screen.findByText('Plan the trip')).toBeOnTheScreen();
    expect(screen.getByText('Biber')).toBeOnTheScreen();
    expect(screen.queryByText('Team standup')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeOnTheScreen();
    expect(query).toHaveBeenCalledWith('topic.recentTopics', { limit: 30 });
  });

  it('invites a first chat when there is none', async () => {
    await renderList(jest.fn(async () => []));

    expect(
      await screen.findByText('No chats yet. Ask Biber to do something for you.'),
    ).toBeOnTheScreen();
  });

  it('offers to try again when the list cannot load', async () => {
    await renderList(
      jest.fn(async () => {
        throw new Error('offline');
      }),
    );

    expect(await screen.findByText('Could not load your chats.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
