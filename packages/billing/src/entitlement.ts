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
  cancelAtPeriodEnd?: boolean | null;
  currentPeriodEnd?: Date | null;
  plan: Plans;
  status?: SubscriptionStatus | null;
}

/**
 * Whether a subscription grants its plan now: its status is entitled, unless it was set to end and
 * its period is over. A prepaid period (WeChat Pay, Alipay) gets no event from its provider when
 * it runs out, so this is what ends it; for the others it only anticipates the provider's event.
 */
export const isGranting = (subscription: HeldSubscription, now = new Date()): boolean =>
  isEntitledStatus(subscription.status) &&
  !(
    subscription.cancelAtPeriodEnd &&
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd.getTime() <= now.getTime()
  );

/** The plan a user is on: the highest one any of their subscriptions currently grants. */
export const effectivePlan = (subscriptions: HeldSubscription[], now = new Date()): Plans =>
  subscriptions
    .filter((subscription) => isGranting(subscription, now))
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
