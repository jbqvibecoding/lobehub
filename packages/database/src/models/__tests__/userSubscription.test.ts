import { Plans } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { UserSubscriptionModel } from '../../models/userSubscription';
import { userSubscriptions } from '../../schemas/billing';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'subscription-user';
const otherUserId = 'subscription-other-user';

const activeStarter = {
  billingInterval: 'monthly' as const,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2026-12-10T00:00:00Z'),
  currentPeriodStart: new Date('2026-11-10T00:00:00Z'),
  plan: Plans.Starter,
  providerSubscriptionId: 'sub_1',
  status: 'active' as const,
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('UserSubscriptionModel', () => {
  it('keeps the first customer linked for a provider, and starts on the free plan', async () => {
    const model = new UserSubscriptionModel(serverDB, userId);

    const first = await model.linkCustomer('stripe', 'cus_first');
    const second = await model.linkCustomer('stripe', 'cus_second');

    expect(first).toMatchObject({ plan: 'free', providerCustomerId: 'cus_first', status: null });
    expect(second.id).toBe(first.id);
    expect(second.providerCustomerId).toBe('cus_first');
  });

  it('rewrites the row of the customer the provider names, and only that one', async () => {
    const model = new UserSubscriptionModel(serverDB, userId);
    const other = new UserSubscriptionModel(serverDB, otherUserId);
    await model.linkCustomer('stripe', 'cus_mine');
    await other.linkCustomer('stripe', 'cus_theirs');
    const syncedAt = new Date('2026-11-10T09:00:00Z');

    const row = await UserSubscriptionModel.applyProviderSnapshot(
      serverDB,
      'stripe',
      'cus_mine',
      activeStarter,
      syncedAt,
    );

    expect(row).toMatchObject({ ...activeStarter, syncedAt, userId });
    expect(await model.list()).toEqual([row]);
    expect((await other.findByProvider('stripe'))?.status).toBeNull();
  });

  it('returns nothing for a customer that was never linked', async () => {
    expect(
      await UserSubscriptionModel.applyProviderSnapshot(serverDB, 'stripe', 'cus_x', activeStarter),
    ).toBeUndefined();
    expect(await serverDB.select().from(userSubscriptions)).toEqual([]);
  });
});
