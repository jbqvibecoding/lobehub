// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  topics,
  userMemories,
  userMemoriesContexts,
  userMemoriesIdentities,
  userMemoriesPreferences,
  userMemoryExtractionChanges,
  userMemoryExtractions,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { KEPT_EXTRACTIONS, UserMemoryExtractionModel } from '../extractions';
import { UserMemoryModel } from '../model';
import { UserMemoryReviewModel } from '../review';

const userId = 'extractions-user';
const otherUserId = 'extractions-other-user';
const serverDB: LobeChatDatabase = await getTestDB();

const vector = (value: number) => Array.from({ length: 1024 }, () => value);

const memory = (id: string, title: string, layer = 'identity') => ({
  id,
  lastAccessedAt: new Date('2026-11-01T08:00:00Z'),
  memoryLayer: layer,
  summary: title,
  title,
  userId,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: 'topic-move', title: 'Moving house', userId });
  await serverDB
    .insert(userMemories)
    .values([
      { ...memory('m-home', 'Lives in Berlin'), summaryVector1024: vector(0.1) },
      memory('m-job', 'Works at Acme'),
      memory('m-new-pref', 'Likes window seats', 'preference'),
      memory('m-new-ctx', 'Looking for a flat', 'context'),
    ]);
  await serverDB.insert(userMemoriesIdentities).values([
    {
      description: 'Lives in Berlin',
      descriptionVector: vector(0.2),
      id: 'id-home',
      role: 'resident',
      userId,
      userMemoryId: 'm-home',
    },
    { description: 'Works at Acme', id: 'id-job', userId, userMemoryId: 'm-job' },
  ]);
  await serverDB
    .insert(userMemoriesPreferences)
    .values({ id: 'pref-seat', userId, userMemoryId: 'm-new-pref' });
  await serverDB
    .insert(userMemoriesContexts)
    .values({ id: 'ctx-flat', title: 'Flat hunt', userId, userMemoryIds: ['m-new-ctx'] });
});

/** What a memory extraction from the "Moving house" chat does: add two, change one, remove one. */
const extract = async () => {
  const extractions = new UserMemoryExtractionModel(serverDB, userId);
  const memories = new UserMemoryModel(serverDB, userId);

  const moved = await extractions.trackIdentityChange('id-home', 'updated', () =>
    memories.updateIdentityEntry({
      base: { summary: 'Lives in Lisbon', title: 'Lives in Lisbon' },
      identity: { description: 'Lives in Lisbon', descriptionVector: vector(0.3) },
      identityId: 'id-home',
    }),
  );
  const quit = await extractions.trackIdentityChange('id-job', 'removed', () =>
    memories.removeIdentityEntry('id-job'),
  );
  return extractions.record({
    addedMemoryIds: ['m-new-pref', 'm-new-ctx'],
    changes: [moved!, quit!],
    topicId: 'topic-move',
  });
};

const title = async (id: string) =>
  (await serverDB.query.userMemories.findFirst({ where: eq(userMemories.id, id) }))?.title;

describe('UserMemoryExtractionModel', () => {
  it('lists what an extraction did', async () => {
    const id = await extract();

    expect(await new UserMemoryExtractionModel(serverDB, userId).list()).toEqual([
      expect.objectContaining({ added: 2, changed: 2, id, topicTitle: 'Moving house' }),
    ]);
    expect(await new UserMemoryExtractionModel(serverDB, otherUserId).list()).toEqual([]);
  });

  it('undoes an extraction: takes back what it added, puts back what it changed or removed', async () => {
    const id = await extract();
    expect(await title('m-home')).toBe('Lives in Lisbon');
    expect(await title('m-job')).toBeUndefined();

    const result = await new UserMemoryExtractionModel(serverDB, userId).undo(id!);

    expect(result).toEqual({ forgotten: 2, notRestored: [], restored: 2 });
    expect(await title('m-new-pref')).toBeUndefined();
    expect(await title('m-new-ctx')).toBeUndefined();
    expect(await serverDB.select().from(userMemoriesContexts)).toEqual([]);

    const home = await serverDB.query.userMemoriesIdentities.findFirst({
      where: eq(userMemoriesIdentities.id, 'id-home'),
    });
    expect(await title('m-home')).toBe('Lives in Berlin');
    expect(home).toMatchObject({ description: 'Lives in Berlin', role: 'resident' });
    expect(home?.descriptionVector?.[0]).toBeCloseTo(0.2);

    expect(await title('m-job')).toBe('Works at Acme');
    expect(
      await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, 'id-job'),
      }),
    ).toMatchObject({ description: 'Works at Acme', userMemoryId: 'm-job' });

    // The chat is not mined again, and nothing is left to undo
    const topic = await serverDB.query.topics.findFirst({ where: eq(topics.id, 'topic-move') });
    expect(topic?.metadata).toMatchObject({ userMemoryExtractUndone: true });
    expect(await serverDB.select().from(userMemoryExtractions)).toEqual([]);
    expect(await serverDB.select().from(userMemoryExtractionChanges)).toEqual([]);
  });

  it('leaves a memory changed since as it is, but not one that was only read', async () => {
    const id = await extract();
    // Retrieval bumps the access counters; that is not a change to what the memory says
    await serverDB
      .update(userMemories)
      .set({ accessedCount: 3, lastAccessedAt: new Date() })
      .where(eq(userMemories.id, 'm-home'));
    expect((await new UserMemoryExtractionModel(serverDB, userId).undo(id!))?.notRestored).toEqual(
      [],
    );

    const again = await extract();
    await new UserMemoryModel(serverDB, userId).updateIdentityEntry({
      base: { title: 'Lives in Porto' },
      identityId: 'id-home',
    });
    const result = await new UserMemoryExtractionModel(serverDB, userId).undo(again!);

    expect(result).toEqual({ forgotten: 0, notRestored: ['Lives in Porto'], restored: 1 });
    expect(await title('m-home')).toBe('Lives in Porto');
  });

  it('keeps no copy of a memory once it is forgotten', async () => {
    await extract();
    await new UserMemoryReviewModel(serverDB, userId).forget('m-home');

    expect(await serverDB.select().from(userMemoryExtractionChanges)).toEqual([
      expect.objectContaining({ kind: 'removed', memoryId: 'm-job' }),
    ]);

    await new UserMemoryReviewModel(serverDB, userId).forgetAll();
    expect(await serverDB.select().from(userMemoryExtractions)).toEqual([]);
    expect(await serverDB.select().from(userMemoryExtractionChanges)).toEqual([]);
  });

  it('drops an extraction from the list once nothing of it is left', async () => {
    const extractions = new UserMemoryExtractionModel(serverDB, userId);
    await extractions.record({
      addedMemoryIds: ['m-new-pref'],
      changes: [],
      topicId: 'topic-move',
    });
    await new UserMemoryReviewModel(serverDB, userId).forget('m-new-pref');

    expect(await extractions.list()).toEqual([]);
  });

  it(`keeps only the latest ${KEPT_EXTRACTIONS} extractions`, async () => {
    const extractions = new UserMemoryExtractionModel(serverDB, userId);
    const ids = Array.from({ length: KEPT_EXTRACTIONS + 2 }, (_, index) => `m-${index}`);
    await serverDB.insert(userMemories).values(ids.map((id) => memory(id, id, 'preference')));
    for (const id of ids) {
      await extractions.record({ addedMemoryIds: [id], changes: [], topicId: 'topic-move' });
    }

    const listed = await extractions.list();
    expect(listed).toHaveLength(KEPT_EXTRACTIONS);
    expect(await serverDB.select().from(userMemoryExtractions)).toHaveLength(KEPT_EXTRACTIONS);
    expect(listed.every((item) => item.added === 1)).toBe(true);
  });

  it('records nothing when an extraction wrote nothing', async () => {
    const extractions = new UserMemoryExtractionModel(serverDB, userId);
    expect(
      await extractions.record({ addedMemoryIds: [], changes: [], topicId: 'topic-move' }),
    ).toBeUndefined();
    expect(await serverDB.select().from(userMemoryExtractions)).toEqual([]);
  });

  it('cannot undo another user’s extraction', async () => {
    const id = await extract();

    expect(await new UserMemoryExtractionModel(serverDB, otherUserId).undo(id!)).toBeUndefined();
    expect(await title('m-new-pref')).toBe('Likes window seats');
    expect(await new UserMemoryExtractionModel(serverDB, userId).list()).toHaveLength(1);
  });
});
