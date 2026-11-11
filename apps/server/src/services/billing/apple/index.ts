import { randomUUID } from 'node:crypto';

import {
  type AppleRenewalInfo,
  appleSubscriptionSnapshot,
  type AppleTransaction,
} from '@lobechat/billing';
import { isPaymentProviderAvailable, regionalIdentifier } from '@lobechat/region';
import debug from 'debug';

import { UserSubscriptionModel } from '@/database/models/userSubscription';
import type { LobeChatDatabase } from '@/database/type';
import { billingEnv } from '@/envs/billing';
import { regionEnv } from '@/envs/region';

import { AppleJwsError, parseAppleRoots, verifyAppleJws } from './jws';

export { AppleJwsError } from './jws';

const log = debug('lobe-server:billing:apple');

let roots: Buffer[] | undefined;
const appleRoots = () => (roots ??= parseAppleRoots(billingEnv.APPLE_ROOT_CERTIFICATES));

export const isAppleConfigured = () => appleRoots().length > 0;

/** Whether plans can be bought through the App Store on this deployment. */
export const isAppleOffered = () =>
  isAppleConfigured() && isPaymentProviderAvailable(regionEnv.APP_REGION, 'apple');

/** The phone app this edition sells through; App Store data for any other app is refused. */
export const appleBundleId = () =>
  billingEnv.APPLE_IAP_BUNDLE_ID || regionalIdentifier('ai.biber.app', regionEnv.APP_REGION);

const readSigned = <T>(jws: string) => verifyAppleJws<T>(jws, { roots: appleRoots() });

const readTransaction = (jws: string) => {
  const transaction = readSigned<AppleTransaction>(jws);
  if (transaction.bundleId !== appleBundleId()) {
    throw new AppleJwsError(`Transaction belongs to another app (${transaction.bundleId})`);
  }
  return transaction;
};

/** Why purchases the phone reported were not recorded. */
export class AppleSyncError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AppleSyncError';
  }
}

/**
 * The UUID the phone attaches to every App Store purchase (`appAccountToken`). Apple returns it
 * on each transaction and notification, and it names the Biber user who bought.
 */
export const appleAccountToken = async (db: LobeChatDatabase, userId: string) => {
  const account = await new UserSubscriptionModel(db, userId).linkCustomer('apple', randomUUID());
  return account.providerCustomerId;
};

const latest = (transactions: AppleTransaction[]) =>
  transactions.reduce((best, next) =>
    (next.expiresDate ?? next.purchaseDate) > (best.expiresDate ?? best.purchaseDate) ? next : best,
  );

/**
 * Records the App Store purchases the phone reports after buying or restoring, as signed by
 * Apple. A subscription bought for another Biber account stays with that account. Newer
 * information wins: a sync older than what is stored changes nothing.
 */
export const syncApplePurchases = async (
  db: LobeChatDatabase,
  userId: string,
  signedTransactions: string[],
) => {
  const transactions = signedTransactions.map(readTransaction);
  if (transactions.length === 0) return;

  const token = await appleAccountToken(db, userId);
  for (const transaction of transactions) {
    if (transaction.appAccountToken && transaction.appAccountToken !== token) {
      throw new AppleSyncError(
        'CONFLICT',
        'This App Store subscription belongs to another account',
      );
    }
    const holder = await UserSubscriptionModel.findByProviderSubscription(
      db,
      'apple',
      transaction.originalTransactionId,
    );
    if (holder && holder.userId !== userId) {
      throw new AppleSyncError(
        'CONFLICT',
        'This App Store subscription belongs to another account',
      );
    }
  }

  const transaction = latest(transactions);
  const snapshot = appleSubscriptionSnapshot(transaction);
  if (!snapshot) {
    throw new AppleSyncError('BAD_REQUEST', `Unknown product ${transaction.productId}`);
  }

  const stored = await new UserSubscriptionModel(db, userId).findByProvider('apple');
  const signedAt = new Date(transaction.signedDate ?? Date.now());
  if (stored?.syncedAt && stored.syncedAt > signedAt) return;

  // The phone does not send renewal info; keep what a notification said about turning renewal off.
  const sameSubscription = stored?.providerSubscriptionId === snapshot.providerSubscriptionId;
  await UserSubscriptionModel.applyProviderSnapshot(
    db,
    'apple',
    token,
    { ...snapshot, cancelAtPeriodEnd: sameSubscription ? !!stored?.cancelAtPeriodEnd : false },
    signedAt,
  );
  log('recorded %s (%s) for user %s', snapshot.plan, snapshot.status, userId);
};

interface AppleNotification {
  data?: {
    bundleId?: string;
    signedRenewalInfo?: string;
    signedTransactionInfo?: string;
  };
  notificationType: string;
  signedDate?: number;
  subtype?: string;
}

/**
 * Applies an App Store Server Notification (V2): renewals, failed payments, renewal turned off or
 * on, expiry, refunds. Throws `AppleJwsError` for a payload Apple did not sign; anything else
 * that cannot be matched to a user is acknowledged and skipped.
 */
export const handleAppleNotification = async (db: LobeChatDatabase, signedPayload: string) => {
  const notification = readSigned<AppleNotification>(signedPayload);
  log('notification %s %s', notification.notificationType, notification.subtype ?? '');

  const data = notification.data;
  if (!data?.signedTransactionInfo) return;
  if (data.bundleId !== appleBundleId()) {
    throw new AppleJwsError(`Notification belongs to another app (${data.bundleId})`);
  }

  const transaction = readTransaction(data.signedTransactionInfo);
  const renewal = data.signedRenewalInfo
    ? readSigned<AppleRenewalInfo>(data.signedRenewalInfo)
    : undefined;
  const snapshot = appleSubscriptionSnapshot(transaction, renewal);
  if (!snapshot) {
    log('skipping unknown product %s', transaction.productId);
    return;
  }

  const customer =
    transaction.appAccountToken ??
    (
      await UserSubscriptionModel.findByProviderSubscription(
        db,
        'apple',
        snapshot.providerSubscriptionId,
      )
    )?.providerCustomerId;
  if (!customer) {
    log('no Biber account for subscription %s', snapshot.providerSubscriptionId);
    return;
  }

  const signedAt = new Date(notification.signedDate ?? Date.now());
  const stored = await UserSubscriptionModel.findByCustomer(db, 'apple', customer);
  if (stored?.syncedAt && stored.syncedAt > signedAt) {
    log('skipping an older notification for %s', snapshot.providerSubscriptionId);
    return;
  }

  const row = await UserSubscriptionModel.applyProviderSnapshot(
    db,
    'apple',
    customer,
    snapshot,
    signedAt,
  );
  if (!row) log('account token %s is not linked to a user', customer);
};
