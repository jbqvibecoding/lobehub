import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { appleSubscriptionSnapshot, type AppleTransaction } from './apple';
import { isEntitledStatus } from './entitlement';

const NOW = Date.UTC(2026, 10, 11);
const DAY = 24 * 60 * 60 * 1000;

const transaction = (overrides: Partial<AppleTransaction> = {}): AppleTransaction => ({
  bundleId: 'ai.biber.app',
  expiresDate: NOW + 20 * DAY,
  originalTransactionId: '2000000123',
  productId: 'ai.biber.premium.monthly',
  purchaseDate: NOW - 10 * DAY,
  transactionId: '2000000456',
  ...overrides,
});

const status = (...args: Parameters<typeof appleSubscriptionSnapshot>) =>
  appleSubscriptionSnapshot(...args)?.status;

describe('appleSubscriptionSnapshot', () => {
  it('maps a paid period to the plan, interval and dates', () => {
    expect(appleSubscriptionSnapshot(transaction(), { autoRenewStatus: 1 }, NOW)).toEqual({
      billingInterval: 'monthly',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(NOW + 20 * DAY),
      currentPeriodStart: new Date(NOW - 10 * DAY),
      plan: Plans.Premium,
      providerSubscriptionId: '2000000123',
      status: 'active',
    });
  });

  it('keeps the plan to the end of the period once renewal is turned off', () => {
    const snapshot = appleSubscriptionSnapshot(transaction(), { autoRenewStatus: 0 }, NOW);

    expect(snapshot?.cancelAtPeriodEnd).toBe(true);
    expect(snapshot?.status).toBe('active');
  });

  it('keeps access through a billing grace period, and ends it when the grace is over', () => {
    const lapsed = transaction({ expiresDate: NOW - DAY });

    const inGrace = status(
      lapsed,
      { gracePeriodExpiresDate: NOW + DAY, isInBillingRetryPeriod: true },
      NOW,
    );
    const afterGrace = status(
      lapsed,
      { gracePeriodExpiresDate: NOW - 1, isInBillingRetryPeriod: true },
      NOW,
    );

    expect(inGrace).toBe('past_due');
    expect(isEntitledStatus(inGrace)).toBe(true);
    expect(afterGrace).toBe('unpaid');
    expect(isEntitledStatus(afterGrace)).toBe(false);
  });

  it('ends a subscription that expired or was refunded', () => {
    expect(status(transaction({ expiresDate: NOW - DAY }), { autoRenewStatus: 0 }, NOW)).toBe(
      'canceled',
    );
    expect(status(transaction({ revocationDate: NOW - DAY }), { autoRenewStatus: 1 }, NOW)).toBe(
      'canceled',
    );
  });

  it('ignores products the catalog does not sell', () => {
    expect(
      appleSubscriptionSnapshot(transaction({ productId: 'ai.biber.coins.100' })),
    ).toBeUndefined();
  });
});
