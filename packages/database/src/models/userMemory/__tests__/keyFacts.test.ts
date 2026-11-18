// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userMemoriesPreferences, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryKeyFactsModel } from '../keyFacts';

const userId = 'key-facts-user';
const otherUserId = 'key-facts-other';
const serverDB: LobeChatDatabase = await getTestDB();

const prefer = (id: string, owner: string, directive: string | null, priority: number) => ({
  conclusionDirectives: directive,
  id,
  scorePriority: priority,
  userId: owner,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(userMemoriesPreferences)
    .values([
      prefer('allergy', userId, 'Never order anything with peanuts', 0.95),
      prefer('meetings', userId, 'No meetings before 10am', 0.8),
      prefer('emoji', userId, 'Likes emoji in replies', 0.3),
      prefer('empty', userId, null, 0.9),
      prefer('theirs', otherUserId, 'Always cc my lawyer', 0.99),
    ]);
});

describe('UserMemoryKeyFactsModel', () => {
  it('gives the user’s standing rules, most important first, and nothing of taste', async () => {
    const rules = await new UserMemoryKeyFactsModel(serverDB, userId).standingInstructions();

    expect(rules.map((rule) => rule.conclusionDirectives)).toEqual([
      'Never order anything with peanuts',
      'No meetings before 10am',
    ]);
  });

  it('keeps to the limit', async () => {
    const rules = await new UserMemoryKeyFactsModel(serverDB, userId).standingInstructions(1);

    expect(rules.map((rule) => rule.id)).toEqual(['allergy']);
  });
});
