// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserProfileService } from '@/server/services/userProfile';

import { cleanupTestUser, createTestUser } from '../../lambda/__tests__/integration/setup';
import { profileRouter } from '../profile';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: mockExecAgent })),
}));

const callerFor = (userId: string) =>
  profileRouter.createCaller({ jwtPayload: { userId }, userId } as any);

beforeEach(async () => {
  testDB = await getTestDB();
  mockExecAgent.mockReset();
  mockExecAgent.mockResolvedValue({ operationId: 'op-1' });
});

describe('mobile profileRouter.startInterview', () => {
  it('starts the interview in a conversation of its own, recorded before Biber runs', async () => {
    const userId = await createTestUser(testDB);
    let recordedWhenRun: string | undefined;
    mockExecAgent.mockImplementation(async () => {
      recordedWhenRun = (await new UserProfileService(testDB, userId).get()).interview.topicId;
      return { operationId: 'op-1' };
    });

    const { operationId, topicId } = await callerFor(userId).startInterview({ locale: 'zh-CN' });

    expect(operationId).toBe('op-1');
    expect(recordedWhenRun).toBe(topicId);
    const [topic] = await testDB.select().from(topics).where(eq(topics.id, topicId));
    expect(topic).toMatchObject({ title: '关于你', userId });
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: topic.agentId,
        appContext: { topicId },
        prompt: '我们开始吧',
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );
    expect((await new UserProfileService(testDB, userId).get()).interview).toMatchObject({
      startedAt: expect.any(String),
      topicId,
    });

    await cleanupTestUser(testDB, userId);
  });

  it('carries on in the same conversation, even after Biber finished it', async () => {
    const userId = await createTestUser(testDB);
    const caller = callerFor(userId);
    const { topicId } = await caller.startInterview({ locale: 'en-US' });
    const profile = new UserProfileService(testDB, userId);
    await profile.finishInterview();

    const again = await caller.startInterview({ locale: 'en-US' });

    expect(again.topicId).toBe(topicId);
    expect(mockExecAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ appContext: { topicId }, prompt: 'Let’s carry on' }),
    );
    expect((await profile.get()).interview.finishedAt).toBeUndefined();

    await cleanupTestUser(testDB, userId);
  });

  it('does not start a second run while Biber is still answering', async () => {
    const userId = await createTestUser(testDB);
    const { topicId } = await callerFor(userId).startInterview({});
    await testDB
      .update(topics)
      .set({ metadata: { runningOperation: { assistantMessageId: 'a', operationId: 'op-live' } } })
      .where(eq(topics.id, topicId));
    mockExecAgent.mockClear();

    expect(await callerFor(userId).startInterview({})).toEqual({
      operationId: 'op-live',
      topicId,
    });
    expect(mockExecAgent).not.toHaveBeenCalled();

    await cleanupTestUser(testDB, userId);
  });

  it("starts afresh when the conversation was deleted, and never opens another user's", async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    const theirs = await callerFor(otherId).startInterview({});
    // Pointing my interview at their conversation does not open it
    await new UserProfileService(testDB, userId).startInterview(theirs.topicId);

    const mine = await callerFor(userId).startInterview({});

    expect(mine.topicId).not.toBe(theirs.topicId);
    const [topic] = await testDB.select().from(topics).where(eq(topics.id, mine.topicId));
    expect(topic.userId).toBe(userId);

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });
});
