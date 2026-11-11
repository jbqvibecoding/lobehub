import type { Plans } from '@lobechat/types';

import { monthsAfter } from './creditPeriod';
import { planRank } from './plans';
import type { BillingInterval } from './types';

export interface PrepaidHolding {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  plan: Plans;
}

export type PrepaidPeriod =
  | { end: Date; ok: true; start: Date }
  /** A lower plan cannot be bought while a higher prepaid one is still running. */
  | { ok: false; reason: 'DOWNGRADE' };

const MONTHS: Record<BillingInterval, number> = { monthly: 1, yearly: 12 };

/**
 * The period a prepaid purchase (WeChat Pay, Alipay) buys, paid at `paidAt`. The same plan adds to
 * what is left; a higher plan starts at once and replaces the rest of the lower one; a lower plan
 * cannot be bought until the higher one ends. A period counts whole calendar months from its start.
 */
export const prepaidPeriod = ({
  current,
  interval,
  paidAt,
  plan,
}: {
  current?: PrepaidHolding;
  interval: BillingInterval;
  paidAt: Date;
  plan: Plans;
}): PrepaidPeriod => {
  const running =
    current?.currentPeriodEnd && current.currentPeriodEnd.getTime() > paidAt.getTime()
      ? current
      : undefined;
  const months = MONTHS[interval];

  if (!running || planRank(plan) > planRank(running.plan)) {
    return { end: monthsAfter(paidAt, months), ok: true, start: paidAt };
  }
  if (planRank(plan) < planRank(running.plan)) return { ok: false, reason: 'DOWNGRADE' };

  return {
    end: monthsAfter(running.currentPeriodEnd!, months),
    ok: true,
    start: running.currentPeriodStart ?? paidAt,
  };
};
