// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  topics,
  userMemories,
  userMemoriesIdentities,
  userMemoryExtractions,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMemoryExtractionModel } from '@/database/models/userMemory';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { LayersEnum, MemorySourceType } from '@/types/userMemory';

import { MemoryExtractionExecutor } from '../extract';
import { keepUndoRecord } from '../extract/extractTopic';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => testDB),
}));

beforeEach(async () => {
  testDB = await getTestDB();
});

// @ts-ignore the constructor is private; the models named here are never called
const createExecutor = (): MemoryExtractionExecutor =>
  new (MemoryExtractionExecutor as any)(
    { aiProvider: {}, memory: {} },
    {
      agentBenchmarkLoCoMo: { model: 'm', provider: 'p' },
      agentGateKeeper: { model: 'm', provider: 'p' },
      agentLayerExtractor: {
        contextLimit: 2048,
        layers: { activity: 'm', context: 'm', experience: 'm', identity: 'm', preference: 'm' },
        model: 'm',
        provider: 'p',
      },
      agentPersonaWriter: { model: 'm', provider: 'p' },
      concurrency: 1,
      embedding: { model: 'm', provider: 'p' },
      featureFlags: { enableBenchmarkLoCoMo: false },
      observabilityS3: { enabled: false },
      webhook: {},
    },
  );

const seedIdentity = async (userId: string, memoryId: string, identityId: string, text: string) => {
  await testDB.insert(userMemories).values({
    id: memoryId,
    lastAccessedAt: new Date(),
    memoryLayer: 'identity',
    summary: text,
    title: text,
    userId,
  });
  await testDB
    .insert(userMemoriesIdentities)
    .values({ description: text, id: identityId, userId, userMemoryId: memoryId });
};

describe('memory extraction undo', () => {
  it('keeps what the identity layer rewrote or removed, as it was', async () => {
    const userId = await createTestUser(testDB);
    await seedIdentity(userId, `m-home-${userId}`, `id-home-${userId}`, 'Lives in Berlin');
    await seedIdentity(userId, `m-job-${userId}`, `id-job-${userId}`, 'Works at Acme');

    const result = await (createExecutor() as any).persistIdentityMemories(
      { source: MemorySourceType.ChatTopic, sourceId: 'topic', userId },
      [],
      {
        add: [],
        remove: [{ id: `id-job-${userId}`, reason: 'left the job' }],
        update: [
          {
            id: `id-home-${userId}`,
            mergeStrategy: 'merge',
            set: {
              summary: 'Lives in Lisbon',
              title: 'Lives in Lisbon',
              withIdentity: { relationship: 'self', role: 'resident', type: 'personal' },
            },
          },
        ],
      },
      {},
      'm',
      undefined,
      testDB,
    );

    expect(result.changes).toEqual([
      expect.objectContaining({
        before: expect.objectContaining({
          memory: expect.objectContaining({ title: 'Lives in Berlin' }),
        }),
        kind: 'updated',
        memoryId: `m-home-${userId}`,
      }),
      expect.objectContaining({ kind: 'removed', memoryId: `m-job-${userId}` }),
    ]);
    const [home] = await testDB
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, `m-home-${userId}`));
    expect(home.title).toBe('Lives in Lisbon');
    await cleanupTestUser(testDB, userId);
  });

  it('does not learn again from a conversation the user undid, even when asked to redo all', async () => {
    const userId = await createTestUser(testDB);
    const [topic] = await testDB
      .insert(topics)
      .values({ metadata: { userMemoryExtractUndone: true }, title: 'Role play', userId })
      .returning();
    const executor = createExecutor();
    const loadModels = vi.spyOn(executor as any, 'getAiProviderRuntimeState');

    const result = await executor.extractTopic({
      forceAll: true,
      forceTopics: true,
      layers: [LayersEnum.Identity],
      source: MemorySourceType.ChatTopic,
      topicId: topic.id,
      userId,
    });

    expect(result).toMatchObject({ extracted: false, memoryIds: [] });
    expect(loadModels).not.toHaveBeenCalled();
    await cleanupTestUser(testDB, userId);
  });

  it('keeps the memories when the undo record cannot be written', async () => {
    const userId = await createTestUser(testDB);

    // The conversation is gone, so the record's reference to it fails
    await expect(
      keepUndoRecord(testDB, userId, 'no-such-topic', ['m-1'], []),
    ).resolves.toBeUndefined();
    expect(
      await testDB
        .select()
        .from(userMemoryExtractions)
        .where(eq(userMemoryExtractions.userId, userId)),
    ).toEqual([]);

    const [topic] = await testDB.insert(topics).values({ title: 'Trip', userId }).returning();
    await testDB.insert(userMemories).values({
      id: `m-trip-${userId}`,
      lastAccessedAt: new Date(),
      title: 'Going to Kyoto',
      userId,
    });
    await keepUndoRecord(testDB, userId, topic.id, [`m-trip-${userId}`], []);
    expect(await new UserMemoryExtractionModel(testDB, userId).list()).toEqual([
      expect.objectContaining({ added: 1, topicTitle: 'Trip' }),
    ]);
    await cleanupTestUser(testDB, userId);
  });
});
