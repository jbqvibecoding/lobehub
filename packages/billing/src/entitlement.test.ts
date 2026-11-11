import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { effectivePlan, needsResync } from './entitlement';

describe('effectivePlan', () => {
  it('is Free without a subscription that currently grants a plan', () => {
    expect(effectivePlan([])).toBe(Plans.Free);
    expect(
      effectivePlan([
        { plan: Plans.Premium, status: 'canceled' },
        { plan: Plans.Ultimate, status: 'incomplete' },
        { plan: Plans.Starter, status: 'unpaid' },
        { plan: Plans.Starter, status: null },
      ]),
    ).toBe(Plans.Free);
  });

  it('keeps the plan while the provider still retries a failed payment', () => {
    expect(effectivePlan([{ plan: Plans.Starter, status: 'past_due' }])).toBe(Plans.Starter);
    expect(effectivePlan([{ plan: Plans.Premium, status: 'trialing' }])).toBe(Plans.Premium);
  });

  it('takes the highest plan when the user pays through two providers', () => {
    expect(
      effectivePlan([
        { plan: Plans.Starter, status: 'active' },
        { plan: Plans.Ultimate, status: 'active' },
        { plan: Plans.Premium, status: 'active' },
      ]),
    ).toBe(Plans.Ultimate);
  });
});

describe('needsResync', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const ended = new Date('2026-11-10T10:00:00Z');

  it('flags a subscription that still grants a plan after its paid period ended', () => {
    expect(needsResync({ currentPeriodEnd: ended, status: 'active' }, now)).toBe(true);
  });

  it('leaves alone one that is within its period, just ended, or no longer grants anything', () => {
    const upcoming = new Date('2026-12-01T00:00:00Z');
    const justEnded = new Date('2026-11-10T11:30:00Z');

    expect(needsResync({ currentPeriodEnd: upcoming, status: 'active' }, now)).toBe(false);
    expect(needsResync({ currentPeriodEnd: justEnded, status: 'active' }, now)).toBe(false);
    expect(needsResync({ currentPeriodEnd: ended, status: 'canceled' }, now)).toBe(false);
  });

  it('does not ask again within ten minutes of the last sync', () => {
    const subscription = { currentPeriodEnd: ended, status: 'active' as const };

    expect(needsResync({ ...subscription, syncedAt: new Date('2026-11-10T11:55:00Z') }, now)).toBe(
      false,
    );
    expect(needsResync({ ...subscription, syncedAt: new Date('2026-11-10T11:45:00Z') }, now)).toBe(
      true,
    );
  });
});
