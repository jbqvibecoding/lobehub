import { apiErrorCode, type ApiClient } from '@/lib/api-client';

import type { AppleStore, Purchase } from './apple-store';

export type PurchaseOutcome = 'active' | 'other-account' | 'rejected' | 'retry-later';

/**
 * Hands App Store purchases to the server, which checks Apple's signature and records the plan,
 * then finishes them with StoreKit. A purchase the server will never take (it belongs to another
 * account, or is not one of ours) is finished too, so StoreKit stops replaying it; finishing does
 * not give up the subscription. When the server cannot be reached, the purchase stays unfinished
 * and StoreKit hands it over again on the next launch.
 */
export const recordPurchases = async ({
  api,
  purchases,
  store,
}: {
  api: ApiClient;
  purchases: Purchase[];
  store: Pick<AppleStore, 'finish'>;
}): Promise<PurchaseOutcome> => {
  const signedTransactions = purchases
    .map((purchase) => purchase.purchaseToken)
    .filter((token): token is string => !!token);
  if (signedTransactions.length === 0) return 'rejected';

  const finishAll = () =>
    Promise.all(purchases.map((purchase) => store.finish(purchase).catch(() => undefined)));

  try {
    await api.mutation('subscription.syncApplePurchases', { signedTransactions });
  } catch (error) {
    const code = apiErrorCode(error);
    if (code === 'CONFLICT' || code === 'BAD_REQUEST') {
      await finishAll();
      return code === 'CONFLICT' ? 'other-account' : 'rejected';
    }
    return 'retry-later';
  }

  await finishAll();
  return 'active';
};
