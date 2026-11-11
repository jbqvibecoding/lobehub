import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isUserCancelledError } from 'expo-iap';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { StringKey } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';

import type { PlanStatus } from '../types';
import { planKey } from '../use-plan';
import { appleStore } from './apple-store';
import { type PurchaseOutcome, recordPurchases } from './record-purchases';
import { type AppleProduct, canBuyInApp } from './upgrade-offers';

const NOTICES: Record<PurchaseOutcome, StringKey> = {
  'active': 'purchaseThanks',
  'other-account': 'purchaseOtherAccount',
  'rejected': 'purchaseFailed',
  'retry-later': 'purchaseRetryLater',
};

/**
 * Buying and restoring plans through the App Store. Purchases go to the server to be checked
 * and recorded; on open, the subscriptions this Apple Account holds are synced quietly, which
 * picks up renewals and purchases made while the app was closed.
 */
export const useAppStore = (api: ApiClient, status: PlanStatus | undefined) => {
  const queryClient = useQueryClient();
  const enabled = !!status && canBuyInApp(status, Platform.OS);
  const [buying, setBuying] = useState<string>();
  const [notice, setNotice] = useState<StringKey>();

  const products = useQuery({
    enabled,
    queryFn: () => api.query('subscription.appleProducts') as Promise<{ products: AppleProduct[] }>,
    queryKey: ['subscription', 'appleProducts'],
  });
  const productIds = products.data?.products.map((product) => product.productId) ?? [];
  const prices = useQuery({
    enabled: enabled && productIds.length > 0,
    queryFn: async () => {
      await appleStore.connect();
      return appleStore.prices(productIds);
    },
    queryKey: ['appleStore', 'prices', productIds],
  });

  const settle = (outcome: PurchaseOutcome) => {
    setBuying(undefined);
    setNotice(NOTICES[outcome]);
    if (outcome === 'active') queryClient.invalidateQueries({ queryKey: planKey });
  };

  useEffect(() => {
    if (!enabled) return;

    const stop = appleStore.listen(
      async (purchase) =>
        settle(await recordPurchases({ api, purchases: [purchase], store: appleStore })),
      (error) => {
        setBuying(undefined);
        if (!isUserCancelledError(error)) setNotice('purchaseFailed');
      },
    );

    appleStore
      .connect()
      .then(() => appleStore.current())
      .then((purchases) =>
        purchases.length > 0 ? recordPurchases({ api, purchases, store: appleStore }) : undefined,
      )
      .then((outcome) => {
        if (outcome === 'active') queryClient.invalidateQueries({ queryKey: planKey });
      })
      .catch(() => undefined);

    return stop;
    // The listener and the quiet sync run once, for as long as buying is possible
  }, [enabled]);

  const buy = async (productId: string) => {
    setNotice(undefined);
    setBuying(productId);
    try {
      const { token } = (await api.mutation('subscription.appleAccountToken')) as { token: string };
      await appleStore.buy(productId, token);
    } catch (error) {
      setBuying(undefined);
      if (!isUserCancelledError(error)) setNotice('purchaseFailed');
    }
  };

  const restore = async () => {
    setNotice(undefined);
    try {
      await appleStore.connect();
      const purchases = await appleStore.current();
      if (purchases.length === 0) {
        setNotice('restoreNothing');
        return;
      }
      settle(await recordPurchases({ api, purchases, store: appleStore }));
    } catch {
      setNotice('purchaseFailed');
    }
  };

  return {
    buy,
    buying,
    enabled,
    manage: () => appleStore.manage(),
    notice,
    prices: prices.data,
    products: products.data?.products ?? [],
    restore,
  };
};
