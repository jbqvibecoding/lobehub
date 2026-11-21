import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { ExpertsView } from './experts';
import type { Expert } from './types';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const researcher: Expert = {
  agentId: 'agt_researcher',
  avatar: '🔎',
  backgroundColor: '#eef',
  description: 'Turns a question into a short, sourced brief.',
  id: 'researcher',
  title: 'Researcher',
};

const writer: Expert = {
  agentId: null,
  avatar: '✍️',
  backgroundColor: '#efe',
  description: 'Drafts and revises posts and emails.',
  id: 'writer',
  title: 'Writer',
};

const renderView = async (experts: () => Promise<Expert[]> = async () => [researcher, writer]) => {
  const query = jest.fn(experts);
  const mutation = jest.fn(async () => ({}));
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
      <ExpertsView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

describe('ExpertsView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the roster in the phone’s language, with what each expert does', async () => {
    const { query } = await renderView();

    expect(await screen.findByText('Researcher')).toBeOnTheScreen();
    expect(screen.getByText('Drafts and revises posts and emails.')).toBeOnTheScreen();
    expect(query).toHaveBeenCalledWith('experts.list', { locale: 'en-US' });
  });

  it('adds an expert to the team with one tap', async () => {
    const user = userEvent.setup();
    const { mutation } = await renderView();

    await user.press(await screen.findByRole('button', { name: 'Add Writer to my team' }));

    expect(mutation).toHaveBeenCalledWith('experts.add', { id: 'writer', locale: 'en-US' });
  });

  it('opens a new chat with an expert already on the team', async () => {
    const user = userEvent.setup();
    await renderView();

    await user.press(await screen.findByRole('button', { name: 'Chat with Researcher' }));

    expect(router.push).toHaveBeenCalledWith({
      params: { agentId: 'agt_researcher', title: 'Researcher', topicId: 'new' },
      pathname: '/chat/[topicId]',
    });
  });

  it('removes an expert only after the user confirms', async () => {
    const user = userEvent.setup();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    const { mutation } = await renderView();

    await user.press(await screen.findByRole('button', { name: 'Remove Researcher?' }));

    expect(alert).toHaveBeenCalledWith(
      'Remove Researcher?',
      expect.stringContaining('chats with this expert are deleted'),
      expect.any(Array),
    );
    expect(mutation).toHaveBeenCalledWith('experts.remove', { id: 'researcher' });
  });

  it('says so when the roster does not load, and tries again', async () => {
    const user = userEvent.setup();
    const { query } = await renderView(async () => {
      throw new Error('offline');
    });

    expect(await screen.findByText('Could not load the experts.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(query).toHaveBeenCalledTimes(2);
  });
});
