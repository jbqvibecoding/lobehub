import type { PlanId, PlanStatus } from '../types';

export interface AppleProduct {
  interval: 'monthly' | 'yearly';
  monthlyCredits: number;
  plan: PlanId;
  productId: string;
}

export interface UpgradeOffer extends AppleProduct {
  /** The App Store's localized price, e.g. "$9.99". */
  price: string;
}

const PLAN_ORDER: PlanId[] = ['free', 'hobby', 'starter', 'premium', 'ultimate'];
const rank = (plan: string) => PLAN_ORDER.indexOf(plan as PlanId);

/**
 * The plans above the current one that the App Store sells, cheapest first. A product the store
 * has no price for (not set up in App Store Connect yet) is left out.
 */
export const upgradeOffers = (
  current: string,
  products: AppleProduct[],
  prices: Map<string, string>,
  interval: AppleProduct['interval'],
): UpgradeOffer[] =>
  products
    .filter(
      (product) =>
        product.interval === interval &&
        rank(product.plan) > rank(current) &&
        prices.has(product.productId),
    )
    .sort((a, b) => rank(a.plan) - rank(b.plan))
    .map((product) => ({ ...product, price: prices.get(product.productId)! }));

/**
 * Whether the phone may sell a plan: the App Store is on for this edition, and the plan is not
 * already billed somewhere else (changing a web subscription happens on the web).
 */
export const canBuyInApp = (status: PlanStatus, os: string) =>
  os === 'ios' &&
  !!status.apple?.available &&
  (!status.subscription || status.subscription.provider === 'apple');
