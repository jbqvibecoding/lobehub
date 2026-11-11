import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { effectivePlan } from './entitlement';
import { prepaidPeriod } from './prepaid';

const paidAt = new Date('2026-11-11T10:00:00Z');

describe('prepaidPeriod', () => {
  it('starts a new period at payment when nothing is running', () => {
    expect(prepaidPeriod({ interval: 'monthly', paidAt, plan: Plans.Starter })).toEqual({
      end: new Date('2026-12-11T10:00:00Z'),
      ok: true,
      start: paidAt,
    });
  });

  it('adds a renewal of the same plan to what is left', () => {
    const current = {
      currentPeriodEnd: new Date('2026-11-20T00:00:00Z'),
      currentPeriodStart: new Date('2026-10-20T00:00:00Z'),
      plan: Plans.Premium,
    };

    expect(prepaidPeriod({ current, interval: 'yearly', paidAt, plan: Plans.Premium })).toEqual({
      end: new Date('2027-11-20T00:00:00Z'),
      ok: true,
      start: current.currentPeriodStart,
    });
  });

  it('starts a higher plan at once, and refuses a lower one while a higher one runs', () => {
    const current = { currentPeriodEnd: new Date('2026-12-01T00:00:00Z'), plan: Plans.Premium };

    expect(
      prepaidPeriod({ current, interval: 'monthly', paidAt, plan: Plans.Ultimate }),
    ).toMatchObject({ ok: true, start: paidAt });
    expect(prepaidPeriod({ current, interval: 'monthly', paidAt, plan: Plans.Starter })).toEqual({
      ok: false,
      reason: 'DOWNGRADE',
    });
  });

  it('treats an expired period as nothing running', () => {
    const current = { currentPeriodEnd: new Date('2026-11-01T00:00:00Z'), plan: Plans.Ultimate };

    expect(
      prepaidPeriod({ current, interval: 'monthly', paidAt, plan: Plans.Starter }),
    ).toMatchObject({ ok: true, start: paidAt });
  });
});

describe('effectivePlan for a prepaid period', () => {
  const prepaid = {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date('2026-12-11T10:00:00Z'),
    plan: Plans.Premium,
    status: 'active' as const,
  };

  it('grants the plan until the period ends, and not after', () => {
    expect(effectivePlan([prepaid], new Date('2026-12-11T09:59:59Z'))).toBe(Plans.Premium);
    expect(effectivePlan([prepaid], new Date('2026-12-11T10:00:00Z'))).toBe(Plans.Free);
  });
});
