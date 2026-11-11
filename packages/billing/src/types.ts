/** Who bills the user. One user can hold a subscription with more than one (web and App Store). */
export type SubscriptionProvider = 'alipay' | 'apple' | 'stripe' | 'wechat';

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
