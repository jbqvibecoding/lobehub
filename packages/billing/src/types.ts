/** Who bills the user. One user can hold a subscription with more than one (web and App Store). */
export type SubscriptionProvider = 'alipay' | 'apple' | 'stripe' | 'wechat';

/**
 * Providers that sell prepaid periods rather than subscriptions (mainland edition): the user pays
 * for a month or a year at a time, and nothing renews on its own.
 */
export const PREPAID_PROVIDERS = ['alipay', 'wechat'] as const;
export type PrepaidProvider = (typeof PREPAID_PROVIDERS)[number];

export const isPrepaidProvider = (provider: string): provider is PrepaidProvider =>
  (PREPAID_PROVIDERS as readonly string[]).includes(provider);

/**
 * A subscription's state in the provider's own lifecycle. The names are Stripe's; other
 * providers are mapped onto them when their events are synced.
 */
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid';

export type BillingInterval = 'monthly' | 'yearly';
