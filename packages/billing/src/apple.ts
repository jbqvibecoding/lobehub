import type { Plans } from '@lobechat/types';

import { planForAppleProductId } from './plans';
import type { BillingInterval, SubscriptionStatus } from './types';

/**
 * The fields of an App Store signed transaction this product reads (`JWSTransactionDecodedPayload`).
 * Dates are milliseconds since the epoch.
 */
export interface AppleTransaction {
  /** The UUID the app attached to the purchase; it names the Biber user who bought. */
  appAccountToken?: string;
  bundleId: string;
  environment?: 'Production' | 'Sandbox' | string;
  expiresDate?: number;
  /** Stays the same across renewals and plan changes; one per subscription. */
  originalTransactionId: string;
  productId: string;
  purchaseDate: number;
  revocationDate?: number;
  signedDate?: number;
  transactionId: string;
  type?: string;
}

/** The fields of an App Store signed renewal info this product reads. */
export interface AppleRenewalInfo {
  /** 1 while the subscription will renew, 0 once the user turned renewal off. */
  autoRenewStatus?: 0 | 1;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  originalTransactionId?: string;
}

export interface AppleSubscriptionSnapshot {
  billingInterval: BillingInterval;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  plan: Plans;
  providerSubscriptionId: string;
  status: SubscriptionStatus;
}

/**
 * Where the subscription stands, in Stripe's status names. Apple keeps a user subscribed through
 * a billing grace period (`past_due`, still entitled); billing retry after the grace period ends
 * the access (`unpaid`). A refunded or revoked purchase is over (`canceled`).
 */
const statusOf = (
  transaction: AppleTransaction,
  renewal: AppleRenewalInfo | undefined,
  now: number,
) => {
  if (transaction.revocationDate) return 'canceled';
  if (transaction.expiresDate && transaction.expiresDate > now) return 'active';
  if (renewal?.isInBillingRetryPeriod) {
    return renewal.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now
      ? 'past_due'
      : 'unpaid';
  }
  return 'canceled';
};

/**
 * A stored subscription from an App Store transaction and, when known, its renewal info.
 * Returns nothing for a product this catalog does not sell.
 */
export const appleSubscriptionSnapshot = (
  transaction: AppleTransaction,
  renewal?: AppleRenewalInfo,
  now = Date.now(),
): AppleSubscriptionSnapshot | undefined => {
  const product = planForAppleProductId(transaction.productId);
  if (!product) return undefined;

  return {
    billingInterval: product.interval,
    cancelAtPeriodEnd: renewal?.autoRenewStatus === 0,
    currentPeriodEnd: new Date(transaction.expiresDate ?? transaction.purchaseDate),
    currentPeriodStart: new Date(transaction.purchaseDate),
    plan: product.plan,
    providerSubscriptionId: transaction.originalTransactionId,
    status: statusOf(transaction, renewal, now),
  };
};
