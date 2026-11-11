import { Plans } from '@lobechat/types';

import { planRank } from './plans';
import type { SubscriptionStatus } from './types';

/**
 * Statuses under which the user keeps what they pay for. `past_due` is included: the provider is
 * still retrying the payment, and it moves the subscription to `canceled` or `unpaid` itself when
 * it gives up. A subscription set to cancel at period end stays `active` until that moment.
 */
const ENTITLED_STATUSES = new Set<SubscriptionStatus>(['active', 'past_due', 'trialing']);

export const isEntitledStatus = (status: SubscriptionStatus | null | undefined): boolean =>
  !!status && ENTITLED_STATUSES.has(status);

interface HeldSubscription {
  plan: Plans;
  status?: SubscriptionStatus | null;
}

/** The plan a user is on: the highest one any of their subscriptions currently grants. */
export const effectivePlan = (subscriptions: HeldSubscription[]): Plans =>
  subscriptions
    .filter((subscription) => isEntitledStatus(subscription.status))
    .reduce<Plans>((best, { plan }) => (planRank(plan) > planRank(best) ? plan : best), Plans.Free);

const RESYNC_AFTER_PERIOD_END_MS = 60 * 60 * 1000;
const RESYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * A stored subscription that still grants a plan although its paid period ended over an hour ago
 * has most likely missed a provider event (renewal or cancellation). It should be read again from
 * the provider, at most every ten minutes.
 */
export const needsResync = (
  subscription: {
    currentPeriodEnd?: Date | null;
    status?: SubscriptionStatus | null;
    syncedAt?: Date | null;
  },
  now: Date,
): boolean => {
  if (!isEntitledStatus(subscription.status) || !subscription.currentPeriodEnd) return false;
  if (now.getTime() - subscription.currentPeriodEnd.getTime() < RESYNC_AFTER_PERIOD_END_MS) {
    return false;
  }

  return (
    !subscription.syncedAt || now.getTime() - subscription.syncedAt.getTime() >= RESYNC_INTERVAL_MS
  );
};
