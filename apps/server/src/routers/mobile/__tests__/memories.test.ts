// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { userMemories, userPersonaDocuments } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../../lambda/__tests__/integration/setup';
import { memoriesRouter } from '../memories';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const callerFor = (userId: string) =>
  memoriesRouter.createCaller({ jwtPayload: { userId }, userId } as any);

const remember = (userId: string, id: string) =>
  testDB.insert(userMemories).values({
    id,
    lastAccessedAt: new Date(),
    memoryLayer: 'preference',
    summary: 'Prefers window seats',
    title: 'Seat preference',
    userId,
  });

beforeEach(async () => {
  testDB = await getTestDB();
});

describe('mobile memoriesRouter', () => {
  it('lists the user’s memories and forgets only their own', async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    await remember(userId, `mine-${userId}`);
    await remember(otherId, `theirs-${otherId}`);
    const caller = callerFor(userId);

    expect((await caller.list(null)).items).toEqual([
      expect.objectContaining({ id: `mine-${userId}`, layer: 'preference' }),
    ]);
    expect(await caller.forget({ id: `theirs-${otherId}` })).toEqual({ forgotten: false });
    expect(await caller.forget({ id: `mine-${userId}` })).toEqual({ forgotten: true });
    expect((await caller.list({ page: 1 })).items).toEqual([]);
    expect(
      await testDB.select().from(userMemories).where(eq(userMemories.userId, otherId)),
    ).toHaveLength(1);

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });

  it('forgetting one memory drops the summary written from it, and only the user’s own', async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    await remember(userId, `mine-${userId}`);
    await summarize(userId);
    await summarize(otherId);

    expect(await callerFor(userId).forget({ id: 'not-a-memory' })).toEqual({ forgotten: false });
    expect(await summaryOf(userId)).toHaveLength(1);

    await callerFor(userId).forget({ id: `mine-${userId}` });
    expect(await summaryOf(userId)).toEqual([]);
    expect(await summaryOf(otherId)).toHaveLength(1);

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });

  it('forgetting everything also drops the summary built from the memories', async () => {
    const userId = await createTestUser(testDB);
    await remember(userId, `mine-${userId}`);
    await summarize(userId);

    await callerFor(userId).forgetAll();

    expect((await callerFor(userId).list(null)).items).toEqual([]);
    expect(await summaryOf(userId)).toEqual([]);
    await cleanupTestUser(testDB, userId);
  });
});

const summarize = (userId: string) =>
  testDB
    .insert(userPersonaDocuments)
    .values({ persona: 'Likes window seats', tagline: 'Traveller', userId });

const summaryOf = (userId: string) =>
  testDB.select().from(userPersonaDocuments).where(eq(userPersonaDocuments.userId, userId));
