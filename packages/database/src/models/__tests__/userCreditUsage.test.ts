import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { UserCreditUsageModel } from '../../models/userCreditUsage';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'credit-user';
const otherUserId = 'credit-other-user';

const november = { end: new Date('2026-12-10T00:00:00Z'), start: new Date('2026-11-10T00:00:00Z') };
const december = { end: new Date('2027-01-10T00:00:00Z'), start: new Date('2026-12-10T00:00:00Z') };

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('UserCreditUsageModel', () => {
  it('counts every call of a window, also when they finish at the same moment', async () => {
    const model = new UserCreditUsageModel(serverDB, userId);

    await Promise.all(Array.from({ length: 10 }, () => model.add(november, 1500)));

    expect(await model.getUsed(november.start)).toBe(15_000);
    expect(await model.add(november, 500)).toBe(15_500);
  });

  it('keeps windows and users apart', async () => {
    const model = new UserCreditUsageModel(serverDB, userId);
    await model.add(november, 1000);
    await new UserCreditUsageModel(serverDB, otherUserId).add(november, 7000);

    expect(await model.getUsed(november.start)).toBe(1000);
    expect(await model.getUsed(december.start)).toBe(0);
  });
});
