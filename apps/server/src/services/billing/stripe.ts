import { isPaymentProviderAvailable } from '@lobechat/region';
import Stripe from 'stripe';

import { billingEnv } from '@/envs/billing';
import { regionEnv } from '@/envs/region';

let client: Stripe | undefined;

export const isStripeConfigured = () => !!billingEnv.STRIPE_SECRET_KEY;

/** Stripe sells here when this deployment has its keys and its edition is billed through Stripe. */
export const isStripeOffered = () =>
  isStripeConfigured() && isPaymentProviderAvailable(regionEnv.APP_REGION, 'stripe');

export const getStripe = (): Stripe => {
  if (!billingEnv.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');

  client ??= new Stripe(billingEnv.STRIPE_SECRET_KEY, {
    appInfo: { name: 'Biber' },
    typescript: true,
  });
  return client;
};
