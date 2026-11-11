export type PlanId = 'free' | 'hobby' | 'premium' | 'starter' | 'ultimate';

export type BillingProvider = 'alipay' | 'apple' | 'stripe' | 'wechat';

/** `subscription.status` from the server; dates arrive as `Date` through superjson. */
export interface PlanStatus {
  /** Whether plans can be bought through the App Store on this deployment. */
  apple?: { available: boolean };
  credits: { monthly: number; periodEnd: Date; remaining: number; used: number };
  plan: PlanId;
  /** Absent on the free plan. */
  subscription?: {
    billingInterval: 'monthly' | 'yearly' | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    plan: PlanId;
    provider: BillingProvider;
    status: string;
  };
}
