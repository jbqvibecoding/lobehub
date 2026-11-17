import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import type { ApiClient } from '@/lib/api-client';

import { Conversation } from './conversation';
import type { ChatHistory } from './types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
}));

const history = (overrides: Partial<ChatHistory> = {}): ChatHistory => ({
  lines: [
    { createdAt: new Date('2025-01-01T09:00:00Z'), id: 'u1', kind: 'user', text: 'Email Ana' },
    {
      createdAt: new Date('2025-01-01T09:00:05Z'),
      id: 'a1',
      kind: 'assistant',
      text: 'Drafting it now.',
    },
  ],
  run: 'idle',
  ...overrides,
});

const renderConversation = async ({
  mutation = jest.fn(async () => ({})),
  onStarted = jest.fn(),
  query = jest.fn(async () => history()),
  // null: a new chat
  topicId = 'topic-1',
}: {
  mutation?: jest.Mock;
  onStarted?: jest.Mock;
  query?: jest.Mock;
  topicId?: string | null;
} = {}) => {
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
      <Conversation
        api={{ mutation, query } as unknown as ApiClient}
        onStarted={onStarted}
        topicId={topicId ?? undefined}
      />
    </QueryClientProvider>,
  );
  return { mutation, onStarted, query };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Conversation', () => {
  it('shows what was said', async () => {
    const { query } = await renderConversation();

    expect(await screen.findByText('Email Ana')).toBeOnTheScreen();
    expect(screen.getByText('Drafting it now.')).toBeOnTheScreen();
    expect(query).toHaveBeenCalledWith('chat.history', { topicId: 'topic-1' });
  });

  it('sends a message into the conversation and clears the box', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-1' }));
    await renderConversation({ mutation });

    await user.type(screen.getByLabelText('Message Biber'), 'And Friday?');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(mutation).toHaveBeenCalledWith('chat.send', { text: 'And Friday?', topicId: 'topic-1' });
    expect(screen.getByLabelText('Message Biber')).toHaveDisplayValue('');
  });

  it('keeps the message in the box when it fails to send', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => {
      throw new Error('offline');
    });
    await renderConversation({ mutation });

    await user.type(screen.getByLabelText('Message Biber'), 'And Friday?');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not sent. Your message is still here; try again.',
    );
    expect(screen.getByLabelText('Message Biber')).toHaveDisplayValue('And Friday?');
  });

  it('starts a chat with Biber and hands over the new conversation', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-new' }));
    const { onStarted, query } = await renderConversation({ mutation, topicId: null });

    expect(screen.getByText(/Ask Biber to plan your week/)).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Message Biber'), 'Plan my week');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(mutation).toHaveBeenCalledWith('chat.send', {
      text: 'Plan my week',
      topicId: undefined,
    });
    expect(onStarted).toHaveBeenCalledWith('topic-new');
    expect(query).not.toHaveBeenCalledWith('chat.history', expect.anything());
  });

  it('answers a call that waits for approval, in place', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => null);
    await renderConversation({
      mutation,
      query: jest.fn(async () =>
        history({
          lines: [
            {
              apiName: 'send_email',
              arguments: '{"to":"ana@example.com"}',
              createdAt: new Date('2025-01-01T09:00:10Z'),
              id: 'tool-1',
              identifier: 'gmail-mcp',
              kind: 'tool',
              status: 'waiting',
              title: 'Send email · gmail-mcp',
              type: 'mcp',
            },
          ],
          run: 'waiting',
        }),
      ),
    });

    await user.press(await screen.findByRole('button', { name: 'Approve' }));

    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledWith('approval.respond', {
      decision: 'approved',
      toolMessageId: 'tool-1',
    });
  });

  it('shows the agent at work and stops it on request', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ stopped: true }));
    await renderConversation({
      mutation,
      query: jest.fn(async () =>
        history({
          lines: [
            ...history().lines,
            {
              createdAt: new Date('2025-01-01T09:00:06Z'),
              id: 'tool-2',
              kind: 'tool',
              status: 'done',
              title: 'Search web · browser',
              type: 'builtin',
            },
          ],
          run: 'running',
        }),
      ),
    });

    expect(await screen.findByText('Working on it…')).toBeOnTheScreen();
    expect(screen.getByText('Search web · browser · Done')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Stop' }));

    expect(mutation).toHaveBeenCalledWith('chat.stop', { topicId: 'topic-1' });
  });
});
