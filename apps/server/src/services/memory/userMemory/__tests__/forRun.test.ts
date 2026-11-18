// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  userMemoriesIdentities,
  userMemoriesPreferences,
  userPersonaDocuments,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { loadUserMemoryForRun } from '../forRun';

let testDB: LobeChatDatabase;

beforeEach(async () => {
  testDB = await getTestDB();
});

describe('loadUserMemoryForRun', () => {
  it('gives nothing to a person Biber knows nothing about', async () => {
    const userId = await createTestUser(testDB);

    expect(await loadUserMemoryForRun(testDB, userId)).toBeUndefined();
    await cleanupTestUser(testDB, userId);
  });

  it('gives key facts verbatim even when the summary leaves them out', async () => {
    const userId = await createTestUser(testDB);
    await testDB
      .insert(userPersonaDocuments)
      .values({ persona: 'Ana runs a small bakery.', tagline: 'Baker', userId });
    await testDB.insert(userMemoriesIdentities).values([
      { description: 'Allergic to peanuts', relationship: 'self', type: 'personal', userId },
      // Someone the person knows is not who the person is
      { description: 'Ana’s brother, a pilot', relationship: 'brother', type: 'personal', userId },
    ]);
    await testDB.insert(userMemoriesPreferences).values([
      { conclusionDirectives: 'Never book flights before 9am', scorePriority: 0.9, userId },
      { conclusionDirectives: 'Likes short replies', scorePriority: 0.4, userId },
    ]);

    const memory = await loadUserMemoryForRun(testDB, userId);

    expect(memory?.memories).toMatchObject({
      identities: [expect.objectContaining({ description: 'Allergic to peanuts' })],
      persona: { narrative: 'Ana runs a small bakery.', tagline: 'Baker' },
      preferences: [
        expect.objectContaining({ conclusionDirectives: 'Never book flights before 9am' }),
      ],
    });
    expect(memory?.memories?.identities).toHaveLength(1);
    expect(memory?.memories?.preferences).toHaveLength(1);
    await cleanupTestUser(testDB, userId);
  });
});
