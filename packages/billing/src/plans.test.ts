import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { PLAN_CATALOG, planForStripeLookupKey, planRank, stripeLookupKeyFor } from './plans';

describe('plan catalog', () => {
  it('maps every sold price back to exactly the plan and interval that sells it', () => {
    const sold = Object.values(Plans).flatMap((plan) =>
      (['monthly', 'yearly'] as const).flatMap((interval) => {
        const lookupKey = stripeLookupKeyFor(plan, interval);
        return lookupKey ? [{ interval, lookupKey, plan }] : [];
      }),
    );

    expect(sold).toHaveLength(6);
    expect(new Set(sold.map((price) => price.lookupKey)).size).toBe(sold.length);
    for (const { interval, lookupKey, plan } of sold) {
      expect(planForStripeLookupKey(lookupKey)).toEqual({ interval, plan });
    }
  });

  it('does not sell the free or the legacy plan, and knows no other price', () => {
    expect(stripeLookupKeyFor(Plans.Free, 'monthly')).toBeUndefined();
    expect(stripeLookupKeyFor(Plans.Hobby, 'yearly')).toBeUndefined();
    expect(planForStripeLookupKey('someone_elses_price')).toBeUndefined();
    expect(planForStripeLookupKey(null)).toBeUndefined();
  });

  it('includes more credits the higher the paid plan', () => {
    const paid = [Plans.Starter, Plans.Premium, Plans.Ultimate];

    expect(paid.map(planRank)).toEqual([...paid.map(planRank)].sort((a, b) => a - b));
    expect(PLAN_CATALOG[Plans.Free].monthlyCredits).toBeLessThan(
      PLAN_CATALOG[Plans.Starter].monthlyCredits,
    );
    expect(PLAN_CATALOG[Plans.Starter].monthlyCredits).toBeLessThan(
      PLAN_CATALOG[Plans.Premium].monthlyCredits,
    );
    expect(PLAN_CATALOG[Plans.Premium].monthlyCredits).toBeLessThan(
      PLAN_CATALOG[Plans.Ultimate].monthlyCredits,
    );
  });
});
