import type { PlanStatus } from '../types';
import { type AppleProduct, canBuyInApp, upgradeOffers } from './upgrade-offers';

const product = (plan: AppleProduct['plan'], interval: AppleProduct['interval']): AppleProduct => ({
  interval,
  monthlyCredits: 1,
  plan,
  productId: `ai.biber.${plan}.${interval}`,
});

const products = (['ultimate', 'starter', 'premium'] as const).flatMap((plan) => [
  product(plan, 'monthly'),
  product(plan, 'yearly'),
]);

describe('upgradeOffers', () => {
  it('offers the plans above the current one, cheapest first, that the store prices', () => {
    const prices = new Map([
      ['ai.biber.premium.monthly', '$19.99'],
      ['ai.biber.ultimate.monthly', '$39.99'],
      ['ai.biber.starter.monthly', '$9.99'],
    ]);

    expect(upgradeOffers('starter', products, prices, 'monthly')).toEqual([
      { ...product('premium', 'monthly'), price: '$19.99' },
      { ...product('ultimate', 'monthly'), price: '$39.99' },
    ]);
    expect(upgradeOffers('free', products, prices, 'yearly')).toEqual([]);
  });
});

describe('canBuyInApp', () => {
  const status = (subscription?: Partial<NonNullable<PlanStatus['subscription']>>): PlanStatus => ({
    apple: { available: true },
    credits: { monthly: 0, periodEnd: new Date(), remaining: 0, used: 0 },
    plan: 'free',
    subscription: subscription && {
      billingInterval: 'monthly',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      plan: 'starter',
      provider: 'apple',
      status: 'active',
      ...subscription,
    },
  });

  it('sells on iPhone to the free plan and to App Store subscribers', () => {
    expect(canBuyInApp(status(), 'ios')).toBe(true);
    expect(canBuyInApp(status({ provider: 'apple' }), 'ios')).toBe(true);
  });

  it('leaves a web subscription to the web, and Android and unavailable stores alone', () => {
    expect(canBuyInApp(status({ provider: 'stripe' }), 'ios')).toBe(false);
    expect(canBuyInApp(status(), 'android')).toBe(false);
    expect(canBuyInApp({ ...status(), apple: { available: false } }, 'ios')).toBe(false);
  });
});
