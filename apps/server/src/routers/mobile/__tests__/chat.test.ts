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
const mockInterruptTask = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
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

  it('says a run is still writing while the runtime reports it active', async () => {
    const chat = await createConversation('op-2');
    await say(chat, 'm-user', 'user', 'Hi', '2026-11-17T09:00:00Z');
    mockGetOperationStatus.mockResolvedValue({ isActive: true, needsHumanInput: false });

    expect((await callerFor(chat.userId).history({ topicId: chat.topicId })).run).toBe('running');

    mockGetOperationStatus.mockResolvedValue(null);
    expect((await callerFor(chat.userId).history({ topicId: chat.topicId })).run).toBe('idle');
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
