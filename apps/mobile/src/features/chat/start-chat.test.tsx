import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';

import type { Expert } from '@/features/settings/types';
import type { ApiClient } from '@/lib/api-client';

import { StartChat } from './start-chat';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

const expert = (id: string, title: string, agentId: string | null): Expert => ({
  agentId,
  avatar: '🔎',
  backgroundColor: '#eef',
  description: `${title} at work`,
  id,
  title,
});

const roster = [
  expert('researcher', 'Researcher', 'agt_researcher'),
  expert('writer', 'Writer', 'agt_writer'),
  expert('seo', 'SEO Consultant', null),
];

const renderStart = async ({
  experts = roster,
  mutation = jest.fn(async () => ({ groupId: 'group-1', title: 'Biber, Researcher, Writer' })),
}: { experts?: Expert[]; mutation?: jest.Mock } = {}) => {
  const onOpenExperts = jest.fn();
  const onStart = jest.fn();
  await render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            mutations: { retry: false },
            queries: { gcTime: Infinity, retry: false },
          },
        })
      }
    >
      <StartChat
        api={{ mutation, query: jest.fn(async () => experts) } as unknown as ApiClient}
        onOpenExperts={onOpenExperts}
        onStart={onStart}
      />
    </QueryClientProvider>,
  );
  return { mutation, onOpenExperts, onStart };
};

describe('StartChat', () => {
  it('starts a chat with Biber or with one of the experts the user added', async () => {
    const user = userEvent.setup();
    const { onStart } = await renderStart();

    await user.press(await screen.findByRole('button', { name: 'Chat with Researcher' }));
    expect(onStart).toHaveBeenLastCalledWith({
      agentId: 'agt_researcher',
      kind: 'agent',
      title: 'Researcher',
    });
    expect(
      screen.queryByRole('button', { name: 'Chat with SEO Consultant' }),
    ).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Message Biber' }));
    expect(onStart).toHaveBeenLastCalledWith({ kind: 'agent', title: 'Biber' });
  });

  it('starts a group chat with the experts picked', async () => {
    const user = userEvent.setup();
    const { mutation, onStart } = await renderStart();

    const start = await screen.findByRole('button', { name: 'Start group chat' });
    expect(start).toBeDisabled();
    await user.press(screen.getByRole('checkbox', { name: 'Researcher' }));
    await user.press(screen.getByRole('checkbox', { name: 'Writer' }));
    expect(screen.getByRole('checkbox', { name: 'Writer' })).toBeChecked();
    await user.press(start);

    expect(mutation).toHaveBeenCalledWith('chat.startGroup', {
      expertIds: ['agt_researcher', 'agt_writer'],
      locale: 'en-US',
    });
    expect(onStart).toHaveBeenCalledWith({
      groupId: 'group-1',
      kind: 'group',
      title: 'Biber, Researcher, Writer',
    });
  });

  it('keeps the picks and says so when the group cannot be started', async () => {
    const user = userEvent.setup();
    const { onStart } = await renderStart({
      mutation: jest.fn(async () => {
        throw new Error('offline');
      }),
    });

    await user.press(await screen.findByRole('checkbox', { name: 'Researcher' }));
    await user.press(screen.getByRole('button', { name: 'Start group chat' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not start the group chat. Try again.',
    );
    expect(screen.getByRole('checkbox', { name: 'Researcher' })).toBeChecked();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('points to the experts screen when none has been added', async () => {
    const user = userEvent.setup();
    const { onOpenExperts } = await renderStart({ experts: [expert('seo', 'SEO', null)] });

    await user.press(await screen.findByRole('button', { name: 'Add experts' }));

    expect(onOpenExperts).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Start group chat' })).not.toBeOnTheScreen();
  });
});
