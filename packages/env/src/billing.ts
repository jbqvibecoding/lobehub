import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Payment provider credentials. Billing is off while they are unset: everyone is on the free
 * plan and nothing can be bought. Stripe is the Global edition's provider (see `@lobechat/region`).
 */
export const getBillingConfig = () => {
  return createEnv({
    runtimeEnv: {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
    server: {
      /** Stripe API key (`sk_live_...` or `sk_test_...`) */
      STRIPE_SECRET_KEY: z.string().optional(),
      /** Signing secret of the webhook endpoint `/api/webhooks/stripe` (`whsec_...`) */
      STRIPE_WEBHOOK_SECRET: z.string().optional(),
    },
  });
};

export const billingEnv = getBillingConfig();
