// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserSubscriptionModel } from '@/database/models/userSubscription';

import { createTestUser } from '../../../../routers/lambda/__tests__/integration/setup';
import {
  appleAccountToken,
  AppleJwsError,
  AppleSyncError,
  handleAppleNotification,
  syncApplePurchases,
} from '../index';
import { signLikeApple } from './fixtures';

vi.mock('@/envs/billing', async () => ({
  billingEnv: { APPLE_ROOT_CERTIFICATES: (await import('./fixtures')).TEST_ROOT },
}));
vi.mock('@/envs/region', () => ({ regionEnv: { APP_REGION: 'global' } }));

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

let db: LobeChatDatabase;
// The test database is shared across tests, so each test gets its own subscription
let subscriptionId: string;

const transaction = (overrides: Record<string, unknown> = {}) => ({
  bundleId: 'ai.biber.app',
  expiresDate: now + 30 * DAY,
  originalTransactionId: subscriptionId,
  productId: 'ai.biber.premium.monthly',
  purchaseDate: now,
  signedDate: now,
  transactionId: '2000000101',
  ...overrides,
});

const notify = (
  notificationType: string,
  tx: Record<string, unknown>,
  renewal: Record<string, unknown> | undefined,
  signedDate = now,
) =>
  handleAppleNotification(
    db,
    signLikeApple({
      data: {
        bundleId: 'ai.biber.app',
        signedRenewalInfo: renewal && signLikeApple(renewal),
        signedTransactionInfo: signLikeApple(tx),
      },
      notificationType,
      signedDate,
    }),
  );

const appleRow = (userId: string) => new UserSubscriptionModel(db, userId).findByProvider('apple');

describe('App Store purchases', () => {
  beforeEach(async () => {
    db = await getTestDB();
    subscriptionId = `2000${Math.floor(Math.random() * 1e9)}`;
  });

  it('records a purchase the phone reports for the user it was bought for', async () => {
    const user = await createTestUser(db);
    const token = await appleAccountToken(db, user);

    await syncApplePurchases(db, user, [signLikeApple(transaction({ appAccountToken: token }))]);

    expect(await appleRow(user)).toMatchObject({
      billingInterval: 'monthly',
      cancelAtPeriodEnd: false,
      plan: 'premium',
      providerCustomerId: token,
      providerSubscriptionId: subscriptionId,
      status: 'active',
    });
    expect(await appleAccountToken(db, user)).toBe(token);
  });

  it('keeps a subscription with the account it was bought for', async () => {
    const buyer = await createTestUser(db);
    const other = await createTestUser(db);
    const token = await appleAccountToken(db, buyer);
    const purchase = signLikeApple(transaction({ appAccountToken: token }));
    await syncApplePurchases(db, buyer, [purchase]);

    await expect(syncApplePurchases(db, other, [purchase])).rejects.toBeInstanceOf(AppleSyncError);
    // Without a token, the subscription is still recognized by its original transaction
    await expect(
      syncApplePurchases(db, other, [signLikeApple(transaction())]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await appleRow(other))?.status ?? null).toBeNull();
  });

  it("refuses another app's transactions", async () => {
    const user = await createTestUser(db);

    await expect(
      syncApplePurchases(db, user, [signLikeApple(transaction({ bundleId: 'com.example.other' }))]),
    ).rejects.toBeInstanceOf(AppleJwsError);
  });

  it('follows renewal turned off, then expiry, from App Store notifications', async () => {
    const user = await createTestUser(db);
    const token = await appleAccountToken(db, user);
    await syncApplePurchases(db, user, [signLikeApple(transaction({ appAccountToken: token }))]);

    await notify(
      'DID_CHANGE_RENEWAL_STATUS',
      transaction({ appAccountToken: token }),
      { autoRenewStatus: 0 },
      now + 1000,
    );
    expect(await appleRow(user)).toMatchObject({ cancelAtPeriodEnd: true, status: 'active' });

    // The phone does not know about renewal; its next sync keeps what the notification said
    await syncApplePurchases(db, user, [
      signLikeApple(transaction({ appAccountToken: token, signedDate: now + 2000 })),
    ]);
    expect((await appleRow(user))?.cancelAtPeriodEnd).toBe(true);

    await notify(
      'EXPIRED',
      transaction({ appAccountToken: token, expiresDate: now - DAY }),
      { autoRenewStatus: 0 },
      now + 3000,
    );
    expect((await appleRow(user))?.status).toBe('canceled');
  });

  it('ignores a notification older than what is stored', async () => {
    const user = await createTestUser(db);
    const token = await appleAccountToken(db, user);
    await notify(
      'DID_RENEW',
      transaction({ appAccountToken: token }),
      { autoRenewStatus: 1 },
      now + 5000,
    );

    await notify(
      'EXPIRED',
      transaction({ appAccountToken: token, expiresDate: now - DAY }),
      undefined,
      now + 1000,
    );

    expect((await appleRow(user))?.status).toBe('active');
  });

  it('matches a notification without a token by its original transaction', async () => {
    const user = await createTestUser(db);
    const token = await appleAccountToken(db, user);
    await syncApplePurchases(db, user, [signLikeApple(transaction({ appAccountToken: token }))]);

    await notify('REFUND', transaction({ revocationDate: now }), undefined, now + 1000);

    expect((await appleRow(user))?.status).toBe('canceled');
  });

  it('acknowledges a notification for a subscription no account holds', async () => {
    await expect(
      notify('SUBSCRIBED', transaction({ originalTransactionId: '999' }), undefined),
    ).resolves.toBeUndefined();
  });
});
