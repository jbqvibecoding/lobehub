// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messagePlugins, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../../lambda/__tests__/integration/setup';
import { approvalRouter } from '../approval';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: mockExecAgent })),
}));

const addToolCall = async (userId: string, id: string, agentId: string, topicId: string) => {
  await testDB.insert(messages).values({ agentId, content: '', id, role: 'tool', topicId, userId });
  await testDB.insert(messagePlugins).values({
    apiName: 'send_email',
    arguments: '{"to":"ana@example.com"}',
    id,
    identifier: 'gmail-mcp',
    intervention: { status: 'pending' },
    toolCallId: `call-${id}`,
    type: 'mcp',
    userId,
  });
};

const createOwnerWithConversation = async () => {
  const userId = await createTestUser(testDB);
  const [agent] = await testDB.insert(agents).values({ title: 'Assistant', userId }).returning();
  const [topic] = await testDB
    .insert(topics)
    .values({ agentId: agent.id, title: 'Trip', userId })
    .returning();
  return { agentId: agent.id, topicId: topic.id, userId };
};

describe('mobile approvalRouter', () => {
  let owner: Awaited<ReturnType<typeof createOwnerWithConversation>>;
  let stranger: Awaited<ReturnType<typeof createOwnerWithConversation>>;

  const callerFor = (userId: string) =>
    approvalRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  beforeEach(async () => {
    testDB = await getTestDB();
    owner = await createOwnerWithConversation();
    stranger = await createOwnerWithConversation();
    await addToolCall(owner.userId, 'tool-owner', owner.agentId, owner.topicId);
    await addToolCall(stranger.userId, 'tool-stranger', stranger.agentId, stranger.topicId);
    mockExecAgent.mockReset();
    mockExecAgent.mockResolvedValue({ operationId: 'op-resumed' });
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, owner.userId);
    await cleanupTestUser(testDB, stranger.userId);
  });

  it("lists only the signed-in user's pending tool calls", async () => {
    const pending = await callerFor(owner.userId).listPending();

    expect(pending.map((item) => item.id)).toEqual(['tool-owner']);
    expect(pending[0]).toMatchObject({ apiName: 'send_email', topicId: owner.topicId });
  });

  it('resumes the paused run with the approval, exactly once', async () => {
    const caller = callerFor(owner.userId);

    await expect(
      caller.respond({ decision: 'approved', toolMessageId: 'tool-owner' }),
    ).resolves.toEqual({ operationId: 'op-resumed' });
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: owner.agentId,
        appContext: expect.objectContaining({ topicId: owner.topicId }),
        parentMessageId: 'tool-owner',
        resume: true,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-owner',
          rejectionReason: undefined,
          toolCallId: 'call-tool-owner',
        },
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );

    await expect(
      caller.respond({ decision: 'rejected', toolMessageId: 'tool-owner' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mockExecAgent).toHaveBeenCalledTimes(1);
  });

  it("cannot answer another user's tool call", async () => {
    await expect(
      callerFor(owner.userId).respond({ decision: 'approved', toolMessageId: 'tool-stranger' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [row] = await testDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, 'tool-stranger'));
    expect(row.intervention).toEqual({ status: 'pending' });
    expect(mockExecAgent).not.toHaveBeenCalled();
  });
});
