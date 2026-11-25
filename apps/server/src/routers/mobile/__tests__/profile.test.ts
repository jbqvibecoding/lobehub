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
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mockExecAgent };
  }),
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

describe('mobile profileRouter: About you', () => {
  it('invites a new user once, until they say "Later" or start', async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    const caller = callerFor(userId);

    expect(await caller.status()).toEqual({ invite: true });
    await caller.dismissInvite();
    expect(await caller.status()).toEqual({ invite: false });

    await callerFor(otherId).startInterview({});
    expect(await callerFor(otherId).status()).toEqual({ invite: false });

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });

  it('does not invite someone Biber already knows something about', async () => {
    const userId = await createTestUser(testDB);
    await callerFor(userId).saveEntry({ section: 'name', text: 'An' });

    expect(await callerFor(userId).status()).toEqual({ invite: false });

    await cleanupTestUser(testDB, userId);
  });

  it('changes, deletes and clears entries through the same rules as Biber', async () => {
    const userId = await createTestUser(testDB);
    const caller = callerFor(userId);
    await new UserProfileService(testDB, userId).saveEntry({ section: 'goals', text: 'Run' });

    expect(await caller.saveEntry({ id: 'G0', section: 'goals', text: 'Swim' })).toMatchObject({
      id: 'G0',
      text: 'Swim',
    });
    await expect(caller.saveEntry({ section: 'goals', text: '  ' })).rejects.toThrow(
      'PROFILE_EMPTY',
    );
    await expect(
      caller.saveEntry({ section: 'now', text: 'card 4111 1111 1111 1111' }),
    ).rejects.toThrow('PROFILE_SECRET');
    await expect(caller.saveEntry({ section: 'goals', text: 'x'.repeat(501) })).rejects.toThrow(
      'PROFILE_TOO_LONG',
    );
    expect((await caller.get()).entries).toEqual([
      expect.objectContaining({ id: 'G0', text: 'Swim' }),
    ]);

    await caller.dropEntry({ id: 'G0' });
    await expect(caller.dropEntry({ id: 'G0' })).rejects.toThrow('PROFILE_NOT_FOUND');
    expect((await caller.get()).entries).toEqual([]);

    await caller.saveEntry({ section: 'goals', text: 'Read' });
    await caller.clear();
    expect(await caller.get()).toEqual({ entries: [], interview: { inviteDismissed: true } });

    await cleanupTestUser(testDB, userId);
  });

  it("never shows or changes another user's profile", async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    await callerFor(otherId).saveEntry({ section: 'goals', text: 'Theirs' });

    expect((await callerFor(userId).get()).entries).toEqual([]);
    await expect(callerFor(userId).dropEntry({ id: 'G0' })).rejects.toThrow('PROFILE_NOT_FOUND');
    await callerFor(userId).clear();
    expect((await callerFor(otherId).get()).entries).toEqual([
      expect.objectContaining({ id: 'G0', text: 'Theirs' }),
    ]);

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });
});
