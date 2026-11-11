import {
  deepLinkToSubscriptions,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  type Purchase,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from 'expo-iap';

/** What the store reports when a purchase does not complete (cancelled, failed, pending). */
export type StoreError = Parameters<Parameters<typeof purchaseErrorListener>[0]>[0];

/**
 * The App Store, through StoreKit 2. Everything the app does with the store goes through here,
 * so the rest of the app (and its tests) does not touch the native module.
 */
export const appleStore = {
  connect: () => initConnection(),

  /** Localized prices for the given products; products the store does not know are left out. */
  prices: async (productIds: string[]) => {
    const products = await fetchProducts({ skus: productIds, type: 'subs' });
    return new Map((products ?? []).map((product) => [product.id, product.displayPrice]));
  },

  /** Starts a purchase; its result arrives through `listen`. */
  buy: (productId: string, appAccountToken: string) =>
    requestPurchase({ request: { apple: { appAccountToken, sku: productId } }, type: 'subs' }),

  listen: (onPurchase: (purchase: Purchase) => void, onError: (error: StoreError) => void) => {
    const purchases = purchaseUpdatedListener(onPurchase);
    const errors = purchaseErrorListener(onError);
    return () => {
      purchases.remove();
      errors.remove();
    };
  },

  /** The subscriptions this Apple Account currently holds, including unfinished ones. */
  current: () => getAvailablePurchases(),

  finish: (purchase: Purchase) => finishTransaction({ isConsumable: false, purchase }),

  /** Opens the App Store's subscription settings (change plan, cancel). */
  manage: () => deepLinkToSubscriptions(),
};

export type AppleStore = typeof appleStore;
export type { Purchase };
