import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Payment provider credentials. Billing is off while they are unset: everyone is on the free
 * plan and nothing can be bought. Stripe is the Global edition's provider (see `@lobechat/region`).
 */
export const getBillingConfig = () => {
  return createEnv({
    runtimeEnv: {
      APPLE_IAP_BUNDLE_ID: process.env.APPLE_IAP_BUNDLE_ID,
      APPLE_ROOT_CERTIFICATES: process.env.APPLE_ROOT_CERTIFICATES,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
    server: {
      /** The phone app's bundle id, when it differs from this edition's (`ai.biber.app`, `.cn`) */
      APPLE_IAP_BUNDLE_ID: z.string().optional(),
      /**
       * Apple's root certificates that App Store purchases are signed under, base64 DER and
       * comma-separated (at least Apple Root CA - G3, from apple.com/certificateauthority). The App
       * Store is off while unset.
       */
      APPLE_ROOT_CERTIFICATES: z.string().optional(),
      /** Stripe API key (`sk_live_...` or `sk_test_...`) */
      STRIPE_SECRET_KEY: z.string().optional(),
      /** Signing secret of the webhook endpoint `/api/webhooks/stripe` (`whsec_...`) */
      STRIPE_WEBHOOK_SECRET: z.string().optional(),
    },
  });
};

export const billingEnv = getBillingConfig();
