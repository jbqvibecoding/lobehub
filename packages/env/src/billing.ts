import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Payment provider credentials. Billing is off while they are unset: everyone is on the free
 * plan and nothing can be bought. Stripe sells in the Global edition, WeChat Pay and Alipay in the
 * mainland edition, and the App Store in both (see `@lobechat/region`).
 */
export const getBillingConfig = () => {
  return createEnv({
    runtimeEnv: {
      ALIPAY_APP_ID: process.env.ALIPAY_APP_ID,
      ALIPAY_GATEWAY: process.env.ALIPAY_GATEWAY,
      ALIPAY_PRIVATE_KEY: process.env.ALIPAY_PRIVATE_KEY,
      ALIPAY_PUBLIC_KEY: process.env.ALIPAY_PUBLIC_KEY,
      APPLE_IAP_BUNDLE_ID: process.env.APPLE_IAP_BUNDLE_ID,
      APPLE_ROOT_CERTIFICATES: process.env.APPLE_ROOT_CERTIFICATES,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      WECHATPAY_APIV3_KEY: process.env.WECHATPAY_APIV3_KEY,
      WECHATPAY_APPID: process.env.WECHATPAY_APPID,
      WECHATPAY_MCHID: process.env.WECHATPAY_MCHID,
      WECHATPAY_MERCHANT_SERIAL_NO: process.env.WECHATPAY_MERCHANT_SERIAL_NO,
      WECHATPAY_PRIVATE_KEY: process.env.WECHATPAY_PRIVATE_KEY,
      WECHATPAY_PUBLIC_KEY: process.env.WECHATPAY_PUBLIC_KEY,
      WECHATPAY_PUBLIC_KEY_ID: process.env.WECHATPAY_PUBLIC_KEY_ID,
    },
    server: {
      /** Alipay open platform app id of the web app that takes payments */
      ALIPAY_APP_ID: z.string().optional(),
      /** Alipay's gateway; defaults to production, set the sandbox gateway to test */
      ALIPAY_GATEWAY: z.string().url().optional(),
      /** The app's RSA2 private key (PKCS#8 or PKCS#1, PEM or bare base64). Alipay is off while unset */
      ALIPAY_PRIVATE_KEY: z.string().optional(),
      /** Alipay's public key from the app's key settings (not the app's own public key) */
      ALIPAY_PUBLIC_KEY: z.string().optional(),
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
      /** WeChat Pay APIv3 key, 32 characters; it decrypts payment notifications */
      WECHATPAY_APIV3_KEY: z.string().optional(),
      /** The app id bound to the merchant: the service account or open platform web app */
      WECHATPAY_APPID: z.string().optional(),
      /** WeChat Pay merchant id. WeChat Pay is off while unset */
      WECHATPAY_MCHID: z.string().optional(),
      /** Serial number of the merchant API certificate whose private key signs requests */
      WECHATPAY_MERCHANT_SERIAL_NO: z.string().optional(),
      /** The merchant API private key (`apiclient_key.pem`), PEM or bare base64 */
      WECHATPAY_PRIVATE_KEY: z.string().optional(),
      /** WeChat Pay's public key, which signs its responses and notifications */
      WECHATPAY_PUBLIC_KEY: z.string().optional(),
      /** That public key's id (`PUB_KEY_ID_...`) */
      WECHATPAY_PUBLIC_KEY_ID: z.string().optional(),
    },
  });
};

export const billingEnv = getBillingConfig();
