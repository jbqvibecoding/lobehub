import Stripe from 'stripe';

import { billingEnv } from '@/envs/billing';

let client: Stripe | undefined;

export const isStripeConfigured = () => !!billingEnv.STRIPE_SECRET_KEY;

export const getStripe = (): Stripe => {
  if (!billingEnv.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');

  client ??= new Stripe(billingEnv.STRIPE_SECRET_KEY, {
    appInfo: { name: 'Biber' },
    typescript: true,
  });
  return client;
};
