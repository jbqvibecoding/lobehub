// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesContexts,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryReviewModel } from '../review';

const userId = 'review-user';
const otherUserId = 'review-other-user';
const serverDB: LobeChatDatabase = await getTestDB();

const memory = (id: string, owner: string, layer: string, day: number) => ({
  capturedAt: new Date(`2026-03-${String(day).padStart(2, '0')}T08:00:00Z`),
  id,
  lastAccessedAt: new Date(),
  memoryLayer: layer,
  summary: `summary of ${id}`,
  title: `title of ${id}`,
  userId: owner,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(userMemories)
    .values([
      memory('m-pref', userId, 'preference', 1),
      memory('m-ctx', userId, 'context', 2),
      memory('m-ctx-2', userId, 'context', 3),
      memory('m-other', otherUserId, 'preference', 4),
    ]);
  await serverDB
    .insert(userMemoriesPreferences)
    .values({ id: 'pref-1', userId, userMemoryId: 'm-pref' });
  await serverDB.insert(userMemoriesContexts).values([
    { id: 'ctx-alone', title: 'Moving to Berlin', userId, userMemoryIds: ['m-ctx'] },
    { id: 'ctx-shared', title: 'Job search', userId, userMemoryIds: ['m-ctx', 'm-ctx-2'] },
  ]);
});

describe('UserMemoryReviewModel', () => {
  it('lists only the user’s memories, newest first, a page at a time', async () => {
    const model = new UserMemoryReviewModel(serverDB, userId);

    const first = await model.list({ pageSize: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['m-ctx-2', 'm-ctx']);
    expect(first.items[0]).toMatchObject({ layer: 'context', title: 'title of m-ctx-2' });
    expect(first.hasMore).toBe(true);

    const second = await model.list({ page: 2, pageSize: 2 });
    expect(second.items.map((item) => item.id)).toEqual(['m-pref']);
    expect(second.hasMore).toBe(false);
  });

  it('forgets a memory together with what carries it', async () => {
    const model = new UserMemoryReviewModel(serverDB, userId);

    expect(await model.forget('m-pref')).toBe(true);
    expect(await serverDB.query.userMemoriesPreferences.findFirst()).toBeUndefined();

    expect(await model.forget('m-ctx')).toBe(true);
    const contexts = await serverDB.select().from(userMemoriesContexts);
    // The context that held only this memory is gone; the shared one keeps the other memory
    expect(contexts).toEqual([
      expect.objectContaining({ id: 'ctx-shared', userMemoryIds: ['m-ctx-2'] }),
    ]);
  });

  it('cannot forget another user’s memory', async () => {
    expect(await new UserMemoryReviewModel(serverDB, userId).forget('m-other')).toBe(false);
    expect(
      await serverDB.select().from(userMemories).where(eq(userMemories.id, 'm-other')),
    ).toHaveLength(1);
  });

  it('forgets everything of one user, contexts included', async () => {
    await new UserMemoryReviewModel(serverDB, userId).forgetAll();

    expect((await serverDB.select().from(userMemories)).map((row) => row.id)).toEqual(['m-other']);
    expect(await serverDB.select().from(userMemoriesContexts)).toEqual([]);
  });
});
