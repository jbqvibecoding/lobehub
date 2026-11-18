// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { MemoryExtractionExecutor } from '../extract';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => testDB),
}));

beforeEach(async () => {
  testDB = await getTestDB();
});

describe('MemoryExtractionExecutor.listConversationsForTopic', () => {
  it('masks secrets before the extractor reads the chat, and keeps the rest', async () => {
    const userId = await createTestUser(testDB);
    const [topic] = await testDB.insert(topics).values({ title: 'Wifi', userId }).returning();
    const sentAt = new Date('2026-11-18T08:00:00Z');
    await testDB.insert(messages).values([
      {
        content: 'Our new wifi password is Tr0ub4dor, and I moved to Lisbon.',
        createdAt: sentAt,
        id: `m1-${userId}`,
        role: 'user',
        topicId: topic.id,
        userId,
      },
      {
        content: 'Noted that you live in Lisbon now.',
        createdAt: new Date('2026-11-18T08:00:05Z'),
        id: `m2-${userId}`,
        role: 'assistant',
        topicId: topic.id,
        userId,
      },
    ]);

    // @ts-ignore the constructor is private; the models named here are never called
    const executor = new MemoryExtractionExecutor(
      { aiProvider: {}, memory: {} } as any,
      {
        agentBenchmarkLoCoMo: { model: 'm', provider: 'p' },
        agentGateKeeper: { model: 'm', provider: 'p' },
        agentLayerExtractor: {
          contextLimit: 2048,
          layers: {
            activity: 'm',
            context: 'm',
            experience: 'm',
            identity: 'm',
            preference: 'm',
          },
          model: 'm',
          provider: 'p',
        },
        agentPersonaWriter: { model: 'm', provider: 'p' },
        concurrency: 1,
        embedding: { model: 'm', provider: 'p' },
        featureFlags: { enableBenchmarkLoCoMo: false },
        observabilityS3: { enabled: false },
        webhook: {},
      } as any,
    );
    const conversation = await executor.listConversationsForTopic(userId, topic.id, sentAt);

    expect(conversation.map((message) => message.content)).toEqual([
      'Our new wifi [REDACTED], and I moved to Lisbon.',
      'Noted that you live in Lisbon now.',
    ]);
    expect(conversation[0].createdAt).toEqual(sentAt);
    await cleanupTestUser(testDB, userId);
  });
});
