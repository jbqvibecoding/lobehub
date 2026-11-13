import { Plans } from '@lobechat/types';

import type { BillingInterval } from './types';

export interface PlanDefinition {
  /**
   * The App Store auto-renewable subscriptions that sell this plan in the phone app. Product ids
   * are unique within an app, so every edition's app uses the same ones.
   */
  appleProductIds?: Record<BillingInterval, string>;
  /**
   * Prepaid prices in the mainland edition, in fen (1/100 yuan), paid with WeChat Pay or Alipay.
   * These periods do not renew on their own.
   */
  cnyPrices?: Record<BillingInterval, number>;
  /** Credits included each month; 1,000,000 credits pay for one US dollar of model usage */
  monthlyCredits: number;
  /**
   * The Stripe prices that sell this plan, by lookup key rather than price id, so the same
   * catalog works in test and live mode. A plan without them cannot be bought.
   */
  stripeLookupKeys?: Record<BillingInterval, string>;
  /**
   * What Stripe charges for this plan, in US cents, for each of its lookup keys. The prices in
   * Stripe are created from these (`scripts/biber/ops.ts stripe prices`).
   */
  usdPrices?: Record<BillingInterval, number>;
}

/**
 * What each plan includes and costs. Plan keys are the product's own (`Plans`). Stripe and the
 * mainland providers charge the prices kept here; App Store prices are set in App Store Connect.
 */
export const PLAN_CATALOG: Record<Plans, PlanDefinition> = {
  [Plans.Free]: { monthlyCredits: 500_000 },
  // Legacy bring-your-own-key plan: kept so stored rows still resolve, not sold
  [Plans.Hobby]: { monthlyCredits: 0 },
  [Plans.Starter]: {
    monthlyCredits: 5_000_000,
    appleProductIds: { monthly: 'ai.biber.starter.monthly', yearly: 'ai.biber.starter.yearly' },
    cnyPrices: { monthly: 6800, yearly: 68_000 },
    stripeLookupKeys: { monthly: 'biber_starter_monthly', yearly: 'biber_starter_yearly' },
    usdPrices: { monthly: 990, yearly: 9900 },
  },
  [Plans.Premium]: {
    monthlyCredits: 15_000_000,
    appleProductIds: { monthly: 'ai.biber.premium.monthly', yearly: 'ai.biber.premium.yearly' },
    cnyPrices: { monthly: 19_800, yearly: 198_000 },
    stripeLookupKeys: { monthly: 'biber_premium_monthly', yearly: 'biber_premium_yearly' },
    usdPrices: { monthly: 2900, yearly: 29_000 },
  },
  [Plans.Ultimate]: {
    monthlyCredits: 35_000_000,
    appleProductIds: { monthly: 'ai.biber.ultimate.monthly', yearly: 'ai.biber.ultimate.yearly' },
    cnyPrices: { monthly: 46_800, yearly: 468_000 },
    stripeLookupKeys: { monthly: 'biber_ultimate_monthly', yearly: 'biber_ultimate_yearly' },
    usdPrices: { monthly: 6900, yearly: 69_000 },
  },
};

/** Lowest to highest; the higher plan wins when a user holds more than one subscription. */
const PLAN_ORDER = [Plans.Free, Plans.Hobby, Plans.Starter, Plans.Premium, Plans.Ultimate];

export const planRank = (plan: Plans): number => PLAN_ORDER.indexOf(plan);

export const monthlyCreditsFor = (plan: Plans): number => PLAN_CATALOG[plan].monthlyCredits;

export const stripeLookupKeyFor = (plan: Plans, interval: BillingInterval): string | undefined =>
  PLAN_CATALOG[plan].stripeLookupKeys?.[interval];

/** The plan and interval a Stripe price sells, from its lookup key. */
export const planForStripeLookupKey = (
  lookupKey: string | null | undefined,
): { interval: BillingInterval; plan: Plans } | undefined => {
  if (!lookupKey) return undefined;

  for (const plan of PLAN_ORDER) {
    const keys = PLAN_CATALOG[plan].stripeLookupKeys;
    if (keys?.monthly === lookupKey) return { interval: 'monthly', plan };
    if (keys?.yearly === lookupKey) return { interval: 'yearly', plan };
  }
  return undefined;
};

export const appleProductIdFor = (plan: Plans, interval: BillingInterval): string | undefined =>
  PLAN_CATALOG[plan].appleProductIds?.[interval];

/** The plan and interval an App Store product sells. */
export const planForAppleProductId = (
  productId: string | null | undefined,
): { interval: BillingInterval; plan: Plans } | undefined => {
  if (!productId) return undefined;

  for (const plan of PLAN_ORDER) {
    const ids = PLAN_CATALOG[plan].appleProductIds;
    if (ids?.monthly === productId) return { interval: 'monthly', plan };
    if (ids?.yearly === productId) return { interval: 'yearly', plan };
  }
  return undefined;
};

/** What Stripe charges for a plan, in US cents; undefined when Stripe does not sell it. */
export const usdPriceFor = (plan: Plans, interval: BillingInterval): number | undefined =>
  PLAN_CATALOG[plan].usdPrices?.[interval];

/** The mainland prepaid price of a plan, in fen; undefined when it is not sold that way. */
export const cnyPriceFor = (plan: Plans, interval: BillingInterval): number | undefined =>
  PLAN_CATALOG[plan].cnyPrices?.[interval];
