import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import type { ApiClient } from '@/lib/api-client';

import { Conversation } from './conversation';
import type { ChatHistory, GroupMember } from './types';

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

const members: GroupMember[] = [
  {
    avatar: '/avatars/biber.png',
    backgroundColor: null,
    id: 'biber',
    isHost: true,
    title: 'Biber',
  },
  {
    avatar: '🔎',
    backgroundColor: '#e0f2fe',
    id: 'researcher',
    isHost: false,
    title: 'Researcher',
  },
  { avatar: '✍️', backgroundColor: '#fef3c7', id: 'writer', isHost: false, title: 'Writer' },
];

/** A group chat: the user asked, the researcher answered twice, then Biber added a line. */
const groupHistory = (): ChatHistory => ({
  groupId: 'group-1',
  lines: [
    { createdAt: new Date('2025-01-01T09:00:00Z'), id: 'u1', kind: 'user', text: 'Sources?' },
    {
      agentId: 'researcher',
      createdAt: new Date('2025-01-01T09:00:05Z'),
      id: 'a1',
      kind: 'assistant',
      text: 'Three good ones.',
    },
    {
      agentId: 'researcher',
      createdAt: new Date('2025-01-01T09:00:06Z'),
      id: 'a2',
      kind: 'assistant',
      text: 'The second is the newest.',
    },
    {
      agentId: 'biber',
      createdAt: new Date('2025-01-01T09:00:07Z'),
      id: 'a3',
      kind: 'assistant',
      text: 'Want a summary?',
    },
  ],
  run: 'idle',
  speakers: Object.fromEntries(members.map(({ id, ...speaker }) => [id, speaker])),
});

/** Answers `chat.group` with the group, and `chat.history` with `chat`. */
const groupQuery = (chat: ChatHistory = groupHistory()) =>
  jest.fn(async (path: string) =>
    path === 'chat.group' ? { members, title: 'Biber, Researcher, Writer' } : chat,
  );

const renderConversation = async ({
  agentId,
  groupId,
  mutation = jest.fn(async () => ({})),
  onStarted = jest.fn(),
  query = jest.fn(async () => history()),
  title,
  // null: a new chat
  topicId = 'topic-1',
}: {
  agentId?: string;
  groupId?: string;
  mutation?: jest.Mock;
  onStarted?: jest.Mock;
  query?: jest.Mock;
  title?: string;
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
        agentId={agentId}
        api={{ mutation, query } as unknown as ApiClient}
        groupId={groupId}
        onStarted={onStarted}
        title={title}
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

  it('starts a new chat with an expert when one was chosen', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-new' }));
    await renderConversation({
      agentId: 'agt_researcher',
      mutation,
      title: 'Researcher',
      topicId: null,
    });

    await user.type(
      screen.getByLabelText('Message Researcher'),
      'Find sources on sleep and memory',
    );
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(mutation).toHaveBeenCalledWith('chat.send', {
      agentId: 'agt_researcher',
      text: 'Find sources on sleep and memory',
      topicId: undefined,
    });
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

  it('says who a one-on-one chat is with in the message box', async () => {
    await renderConversation({
      query: jest.fn(async () => ({
        ...history(),
        agentId: 'researcher',
        speakers: { researcher: { avatar: '🔎', backgroundColor: null, title: 'Researcher' } },
      })),
    });

    expect(await screen.findByLabelText('Message Researcher')).toBeOnTheScreen();
  });
});

describe('Conversation in a group chat', () => {
  it('names who answered, once for each run of answers from the same speaker', async () => {
    await renderConversation({ query: groupQuery() });

    expect(await screen.findByText('Three good ones.')).toBeOnTheScreen();
    expect(screen.getByText('The second is the newest.')).toBeOnTheScreen();
    expect(screen.getAllByText('Researcher')).toHaveLength(1);
    expect(screen.getAllByText('Biber')).toHaveLength(1);
    expect(
      screen.getByLabelText('Message the group, or type @ to ask one expert'),
    ).toBeOnTheScreen();
  });

  it('offers the experts when @ is typed and sends the one picked as a mention', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-1' }));
    await renderConversation({ mutation, query: groupQuery() });
    const box = await screen.findByLabelText('Message the group, or type @ to ask one expert');

    await user.type(box, '@Re');
    expect(screen.queryByRole('menuitem', { name: 'Mention Writer' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('menuitem', { name: 'Mention Researcher' }));
    expect(box).toHaveDisplayValue('@Researcher ');
    await user.type(box, 'find sources');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(mutation).toHaveBeenCalledWith('chat.send', {
      mentions: ['researcher'],
      text: '@Researcher find sources',
      topicId: 'topic-1',
    });
    expect(box).toHaveDisplayValue('');
  });

  it('opens the list of experts from the @ button and drops a mention erased from the text', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-1' }));
    await renderConversation({ mutation, query: groupQuery() });
    const box = await screen.findByLabelText('Message the group, or type @ to ask one expert');

    await user.press(screen.getByRole('button', { name: 'Mention an expert' }));
    expect(screen.getByRole('menuitem', { name: 'Mention Researcher' })).toBeOnTheScreen();
    await user.press(screen.getByRole('menuitem', { name: 'Mention Writer' }));
    await user.clear(box);
    await user.type(box, 'Thoughts, anyone?');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(mutation).toHaveBeenCalledWith('chat.send', {
      text: 'Thoughts, anyone?',
      topicId: 'topic-1',
    });
  });

  it('sends the first message of a group chat just started into that group', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-new' }));
    const query = groupQuery();
    const { onStarted } = await renderConversation({
      groupId: 'group-1',
      mutation,
      query,
      topicId: null,
    });

    const box = await screen.findByLabelText('Message the group, or type @ to ask one expert');
    expect(query).toHaveBeenCalledWith('chat.group', { groupId: 'group-1' });
    await user.type(box, 'Plan a launch post');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(mutation).toHaveBeenCalledWith('chat.send', {
      groupId: 'group-1',
      text: 'Plan a launch post',
      topicId: undefined,
    });
    expect(onStarted).toHaveBeenCalledWith('topic-new');
  });
});
