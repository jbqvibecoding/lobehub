import { describeCredits, describeRenewal, formatCredits, planName } from './describe-plan';
import type { PlanStatus } from './types';

const status = (subscription?: Partial<NonNullable<PlanStatus['subscription']>>): PlanStatus => ({
  credits: {
    monthly: 5_000_000,
    periodEnd: new Date(2026, 11, 3),
    remaining: 3_765_433,
    used: 1_234_567,
  },
  plan: subscription ? 'starter' : 'free',
  subscription: subscription && {
    billingInterval: 'monthly',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(2026, 11, 3),
    plan: 'starter',
    provider: 'stripe',
    status: 'active',
    ...subscription,
  },
});

describe('describe-plan', () => {
  it('shows credits like the web: millions as "M", smaller amounts in full', () => {
    expect(formatCredits(5_000_000, 'en-US')).toBe('5M');
    expect(formatCredits(1_234_567, 'en-US')).toBe('1.23M');
    expect(formatCredits(500_000, 'en-US')).toBe('500,000');
  });

  it('tells a renewing plan from one that ends and from a failed payment', () => {
    expect(describeRenewal(status(), 'en-US')).toBeUndefined();
    expect(describeRenewal(status({}), 'en-US')).toEqual({
      text: 'Renews on Dec 3, 2026',
      tone: 'normal',
    });
    expect(describeRenewal(status({ cancelAtPeriodEnd: true }), 'en-US')).toEqual({
      text: 'Ends on Dec 3, 2026. You keep it until then.',
      tone: 'warning',
    });
    expect(describeRenewal(status({ status: 'past_due' }), 'en-US')?.tone).toBe('problem');
  });

  it('reports usage against the monthly credits, capped at full', () => {
    expect(describeCredits(status(), 'en-US')).toEqual({
      reset: 'Resets on Dec 3, 2026',
      usedFraction: 1_234_567 / 5_000_000,
      usedText: '1.23M of 5M credits used this month',
    });
    const over = status();
    over.credits.used = 6_000_000;
    expect(describeCredits(over, 'en-US').usedFraction).toBe(1);
  });

  it('names plans a newer server adds by their raw name', () => {
    expect(planName('premium')).toBe('Premium');
    expect(planName('team')).toBe('team');
  });
});
