// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messagePlugins, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../../lambda/__tests__/integration/setup';
import { chatRouter } from '../chat';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const mockExecAgent = vi.fn();
const mockExecGroupAgent = vi.fn();
const mockInterruptTask = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
    execGroupAgent: mockExecGroupAgent,
    interruptTask: mockInterruptTask,
  })),
}));

const mockGetOperationStatus = vi.fn();
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    getOperationStatus: mockGetOperationStatus,
  })),
}));

const callerFor = (userId: string) =>
  chatRouter.createCaller({ jwtPayload: { userId }, userId } as any);

const createConversation = async (operationId?: string) => {
  const userId = await createTestUser(testDB);
  const [agent] = await testDB.insert(agents).values({ title: 'Assistant', userId }).returning();
  const [topic] = await testDB
    .insert(topics)
    .values({
      agentId: agent.id,
      metadata: operationId
        ? { runningOperation: { assistantMessageId: 'a', operationId } }
        : undefined,
      title: 'Trip',
      userId,
    })
    .returning();
  return { agentId: agent.id, topicId: topic.id, userId };
};

const say = (
  conversation: Awaited<ReturnType<typeof createConversation>>,
  id: string,
  role: 'assistant' | 'tool' | 'user',
  content: string,
  at: string,
) =>
  testDB.insert(messages).values({
    agentId: conversation.agentId,
    content,
    createdAt: new Date(at),
    id,
    role,
    topicId: conversation.topicId,
    userId: conversation.userId,
  });

beforeEach(async () => {
  testDB = await getTestDB();
  mockExecAgent.mockReset();
  mockExecGroupAgent.mockReset();
  mockInterruptTask.mockReset();
  mockGetOperationStatus.mockReset();
});

describe('mobile chatRouter.history', () => {
  it('reads the conversation back as lines, with a call waiting for an answer', async () => {
    const chat = await createConversation('op-1');
    await say(chat, 'm-user', 'user', 'Email Ana the plan', '2026-11-17T09:00:00Z');
    await say(chat, 'm-empty', 'assistant', '', '2026-11-17T09:00:01Z');
    await say(chat, 'm-tool', 'tool', '', '2026-11-17T09:00:02Z');
    await testDB.insert(messagePlugins).values({
      apiName: 'send_email',
      arguments: '{"to":"ana@example.com"}',
      id: 'm-tool',
      identifier: 'gmail-mcp',
      intervention: { status: 'pending' },
      toolCallId: 'call-1',
      type: 'mcp',
      userId: chat.userId,
    });

    const { lines, run } = await callerFor(chat.userId).history({ topicId: chat.topicId });

    expect(lines.map((line) => [line.id, line.kind])).toEqual([
      ['m-user', 'user'],
      ['m-tool', 'tool'],
    ]);
    expect(lines[1]).toMatchObject({
      arguments: '{"to":"ana@example.com"}',
      status: 'waiting',
      title: 'Send email · gmail-mcp',
    });
    expect(run).toBe('waiting');
    await cleanupTestUser(testDB, chat.userId);
  });

  it('hands over a file a call exported, with a link the phone can open', async () => {
    const chat = await createConversation();
    await say(chat, 'm-user', 'user', 'Make a deck', '2026-11-17T09:00:00Z');
    for (const [id, state] of [
      [
        'm-export',
        {
          downloadUrl: '/f/file-1',
          fileId: 'file-1',
          filename: 'deck.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          size: 51_200,
          success: true,
        },
      ],
      ['m-refused', { filename: 'empty.pptx', success: false }],
    ] as const) {
      await say(chat, id, 'tool', '', '2026-11-17T09:00:01Z');
      await testDB.insert(messagePlugins).values({
        apiName: 'exportFile',
        id,
        identifier: 'lobe-cloud-sandbox',
        state,
        type: 'builtin',
        userId: chat.userId,
      });
    }

    const { lines } = await callerFor(chat.userId).history({ topicId: chat.topicId });

    const exported = lines.find((line) => line.id === 'm-export');
    expect(exported).toMatchObject({
      file: {
        id: 'file-1',
        name: 'deck.pptx',
        size: 51_200,
        url: expect.stringMatching(/\/f\/file-1$/),
      },
      kind: 'tool',
    });
    expect(lines.find((line) => line.id === 'm-refused')).not.toHaveProperty('file');
    await cleanupTestUser(testDB, chat.userId);
  });

  it('says a run is still writing while the runtime reports it active', async () => {
    const chat = await createConversation('op-2');
    await say(chat, 'm-user', 'user', 'Hi', '2026-11-17T09:00:00Z');
    mockGetOperationStatus.mockResolvedValue({ isActive: true, needsHumanInput: false });

    expect((await callerFor(chat.userId).history({ topicId: chat.topicId })).run).toBe('running');

    mockGetOperationStatus.mockResolvedValue(null);
    expect((await callerFor(chat.userId).history({ topicId: chat.topicId })).run).toBe('idle');
    await cleanupTestUser(testDB, chat.userId);
  });

  it('says who a one-on-one chat is with', async () => {
    const chat = await createConversation();

    const history = await callerFor(chat.userId).history({ topicId: chat.topicId });

    expect(history.agentId).toBe(chat.agentId);
    expect(history.groupId).toBeUndefined();
    expect(history.speakers[chat.agentId]).toMatchObject({ title: 'Assistant' });
    await cleanupTestUser(testDB, chat.userId);
  });

  it("does not show someone else's conversation", async () => {
    const chat = await createConversation();
    const stranger = await createConversation();

    await expect(
      callerFor(stranger.userId).history({ topicId: chat.topicId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await cleanupTestUser(testDB, chat.userId);
    await cleanupTestUser(testDB, stranger.userId);
  });
});

describe('mobile chatRouter.send', () => {
  it('starts a conversation with Biber, asking before calls that need approval', async () => {
    const { userId } = await createConversation();
    mockExecAgent.mockResolvedValue({ operationId: 'op-new', topicId: 'topic-new' });

    expect(await callerFor(userId).send({ text: '  Plan my week ' })).toEqual({
      operationId: 'op-new',
      topicId: 'topic-new',
    });
    expect(mockExecAgent).toHaveBeenCalledWith({
      agentId: undefined,
      appContext: undefined,
      prompt: 'Plan my week',
      slug: 'inbox',
      trigger: 'chat',
      userInterventionConfig: { approvalMode: 'manual' },
    });
    await cleanupTestUser(testDB, userId);
  });

  it("continues a conversation with that conversation's agent", async () => {
    const chat = await createConversation();
    mockExecAgent.mockResolvedValue({ operationId: 'op-next', topicId: chat.topicId });

    await callerFor(chat.userId).send({ text: 'And Friday?', topicId: chat.topicId });

    expect(mockExecAgent.mock.calls[0][0]).toMatchObject({
      agentId: chat.agentId,
      appContext: { topicId: chat.topicId },
      slug: undefined,
    });
    await cleanupTestUser(testDB, chat.userId);
  });
});

describe('mobile chatRouter.stop', () => {
  it("stops the conversation's current run", async () => {
    const chat = await createConversation('op-3');
    mockInterruptTask.mockResolvedValue({ success: true });

    expect(await callerFor(chat.userId).stop({ topicId: chat.topicId })).toEqual({
      stopped: true,
    });
    expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-3', topicId: chat.topicId });
    await cleanupTestUser(testDB, chat.userId);
  });
});

describe('mobile chatRouter group chats', () => {
  /** A user with two experts and a group Biber hosts with them. */
  const groupWithExperts = async () => {
    const userId = await createTestUser(testDB);
    const [researcher, writer] = await testDB
      .insert(agents)
      .values([
        { avatar: '🔎', title: 'Researcher', userId },
        { avatar: '✍️', title: 'Writer', userId },
      ])
      .returning();
    const caller = callerFor(userId);
    const { groupId } = await caller.startGroup({
      expertIds: [researcher.id, writer.id],
      locale: 'en-US',
    });
    return { caller, groupId, researcher, userId, writer };
  };

  it('starts a group Biber hosts, named after the experts in it', async () => {
    const { caller, groupId, researcher, writer } = await groupWithExperts();

    const { members, title } = await caller.group({ groupId });
    expect(members.map(({ isHost, title }) => ({ isHost, title }))).toEqual([
      { isHost: true, title: 'Biber' },
      { isHost: false, title: 'Researcher' },
      { isHost: false, title: 'Writer' },
    ]);
    expect(members.slice(1).map((member) => member.id)).toEqual([researcher.id, writer.id]);
    expect(title).toBe('Biber, Researcher, Writer');
  });

  it('lets the one expert the user mentioned answer directly', async () => {
    const { caller, groupId, researcher } = await groupWithExperts();
    mockExecAgent.mockResolvedValue({ operationId: 'op-1' });

    const { topicId } = await caller.send({
      groupId,
      mentions: [researcher.id],
      text: '@Researcher what changed in the EU AI Act this year?',
    });

    expect(mockExecGroupAgent).not.toHaveBeenCalled();
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: researcher.id,
        appContext: { groupId, topicId },
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );
    const topic = await testDB.query.topics.findFirst({ where: (t, { eq }) => eq(t.id, topicId) });
    expect(topic?.groupId).toBe(groupId);
  });

  it('hands everything else to Biber, with how to host and who was mentioned', async () => {
    const { caller, groupId, researcher, writer } = await groupWithExperts();
    mockExecGroupAgent.mockResolvedValue({ operationId: 'op-2', topicId: 'topic-new' });
    const host = (await caller.group({ groupId })).members[0];

    expect(await caller.send({ groupId, text: 'Plan a launch post' })).toEqual({
      operationId: 'op-2',
      topicId: 'topic-new',
    });
    expect(mockExecGroupAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentId: host.id,
        groupId,
        instructions: expect.stringContaining('Hosting this group chat'),
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );

    await caller.send({ groupId, mentions: [researcher.id, writer.id], text: 'Both of you?' });
    expect(mockExecGroupAgent.mock.lastCall![0].instructions).toContain(
      'The user addressed @Researcher, @Writer',
    );
    expect(mockExecAgent).not.toHaveBeenCalled();
  });

  it('refuses a mention of someone not in the group, or Biber itself', async () => {
    const { caller, groupId, userId } = await groupWithExperts();
    const [outsider] = await testDB
      .insert(agents)
      .values({ title: 'Outsider', userId })
      .returning();
    const host = (await caller.group({ groupId })).members[0];

    for (const mention of [outsider.id, host.id]) {
      await expect(caller.send({ groupId, mentions: [mention], text: 'hello' })).rejects.toThrow(
        'not in the group',
      );
    }
    expect(mockExecAgent).not.toHaveBeenCalled();
    expect(mockExecGroupAgent).not.toHaveBeenCalled();
  });

  it('reads a group chat back with who said what', async () => {
    const { caller, groupId, researcher, userId } = await groupWithExperts();
    const host = (await caller.group({ groupId })).members[0];
    const [topic] = await testDB
      .insert(topics)
      .values({ agentId: host.id, groupId, title: 'Launch', userId })
      .returning();
    const line = (
      id: string,
      role: 'assistant' | 'user',
      agentId: string,
      content: string,
      at: string,
    ) =>
      testDB.insert(messages).values({
        agentId,
        content,
        createdAt: new Date(at),
        groupId,
        id,
        role,
        topicId: topic.id,
        userId,
      });
    await line('g-user', 'user', host.id, 'Plan a launch post', '2026-11-21T09:00:00Z');
    await line('g-biber', 'assistant', host.id, 'Asking Researcher.', '2026-11-21T09:00:01Z');
    await line(
      'g-expert',
      'assistant',
      researcher.id,
      'Here are three angles.',
      '2026-11-21T09:00:02Z',
    );

    const history = await caller.history({ topicId: topic.id });

    expect(history.groupId).toBe(groupId);
    expect(history.lines.map(({ agentId, kind, text }: any) => ({ agentId, kind, text }))).toEqual([
      { agentId: undefined, kind: 'user', text: 'Plan a launch post' },
      { agentId: host.id, kind: 'assistant', text: 'Asking Researcher.' },
      { agentId: researcher.id, kind: 'assistant', text: 'Here are three angles.' },
    ]);
    expect(history.speakers[researcher.id]).toMatchObject({ avatar: '🔎', title: 'Researcher' });
    expect(history.speakers[host.id]).toMatchObject({ isHost: true, title: 'Biber' });
  });

  it('changes who is in the group, but Biber stays', async () => {
    const { caller, groupId, researcher, userId, writer } = await groupWithExperts();
    const [seo] = await testDB.insert(agents).values({ title: 'SEO', userId }).returning();
    const host = (await caller.group({ groupId })).members[0];

    const { members } = await caller.updateGroup({
      addExpertIds: [seo.id],
      groupId,
      removeExpertIds: [writer.id],
    });
    expect(members.map((member) => member.id)).toEqual([host.id, researcher.id, seo.id]);
    await expect(caller.updateGroup({ groupId, removeExpertIds: [host.id] })).rejects.toThrow(
      'stays',
    );
  });

  it('keeps one user’s group to themselves', async () => {
    const { groupId } = await groupWithExperts();
    const stranger = callerFor(await createTestUser(testDB));

    await expect(stranger.group({ groupId })).rejects.toThrow('No such group');
    await expect(stranger.send({ groupId, text: 'hi' })).rejects.toThrow();
    expect(mockExecGroupAgent).not.toHaveBeenCalled();
  });
});
