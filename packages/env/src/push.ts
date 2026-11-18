import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Android phones in mainland China have no Google services, so notifications reach them through
 * the phone maker's own push service. Each maker's channel is off while its keys are unset; the
 * phone then falls back to Expo, which only reaches phones with Google services. The mainland
 * iPhone app sends to Apple (APNs) directly rather than through Expo's servers abroad.
 */
export const getPushConfig = () => {
  return createEnv({
    runtimeEnv: {
      APNS_ENDPOINT: process.env.APNS_ENDPOINT,
      APNS_ENVIRONMENT: process.env.APNS_ENVIRONMENT,
      APNS_KEY_ID: process.env.APNS_KEY_ID,
      APNS_PRIVATE_KEY: process.env.APNS_PRIVATE_KEY,
      APNS_TEAM_ID: process.env.APNS_TEAM_ID,
      HONOR_PUSH_APP_ID: process.env.HONOR_PUSH_APP_ID,
      HONOR_PUSH_CLIENT_ID: process.env.HONOR_PUSH_CLIENT_ID,
      HONOR_PUSH_CLIENT_SECRET: process.env.HONOR_PUSH_CLIENT_SECRET,
      HUAWEI_PUSH_APP_ID: process.env.HUAWEI_PUSH_APP_ID,
      HUAWEI_PUSH_CATEGORY: process.env.HUAWEI_PUSH_CATEGORY,
      HUAWEI_PUSH_CLIENT_SECRET: process.env.HUAWEI_PUSH_CLIENT_SECRET,
      OPPO_PUSH_APP_KEY: process.env.OPPO_PUSH_APP_KEY,
      OPPO_PUSH_CHANNEL_ID: process.env.OPPO_PUSH_CHANNEL_ID,
      OPPO_PUSH_MASTER_SECRET: process.env.OPPO_PUSH_MASTER_SECRET,
      VIVO_PUSH_APP_ID: process.env.VIVO_PUSH_APP_ID,
      VIVO_PUSH_APP_KEY: process.env.VIVO_PUSH_APP_KEY,
      VIVO_PUSH_APP_SECRET: process.env.VIVO_PUSH_APP_SECRET,
      VIVO_PUSH_CATEGORY: process.env.VIVO_PUSH_CATEGORY,
      XIAOMI_PUSH_APP_SECRET: process.env.XIAOMI_PUSH_APP_SECRET,
      XIAOMI_PUSH_CHANNEL_ID: process.env.XIAOMI_PUSH_CHANNEL_ID,
    },
    server: {
      /** Where to reach APNs; only to point at a stand-in. Otherwise follows `APNS_ENVIRONMENT`. */
      APNS_ENDPOINT: z.string().url().optional(),
      /** `production` (App Store and TestFlight builds, the default) or `sandbox` (development builds) */
      APNS_ENVIRONMENT: z.enum(['production', 'sandbox']).optional(),
      /** APNs token auth: the key's id, the `.p8` key itself (PEM, `\n` escapes allowed), the team id */
      APNS_KEY_ID: z.string().optional(),
      APNS_PRIVATE_KEY: z.string().optional(),
      APNS_TEAM_ID: z.string().optional(),
      /** Honor Push: the app id, and the OAuth client from the app's Push settings */
      HONOR_PUSH_APP_ID: z.string().optional(),
      HONOR_PUSH_CLIENT_ID: z.string().optional(),
      HONOR_PUSH_CLIENT_SECRET: z.string().optional(),
      /** Huawei Push Kit: the AppGallery Connect app id (also the OAuth client id) and secret */
      HUAWEI_PUSH_APP_ID: z.string().optional(),
      /** The self-classification category Huawei granted, e.g. `WORK`; without one Huawei classifies */
      HUAWEI_PUSH_CATEGORY: z.string().optional(),
      HUAWEI_PUSH_CLIENT_SECRET: z.string().optional(),
      /** OPPO Push: the AppKey and MasterSecret */
      OPPO_PUSH_APP_KEY: z.string().optional(),
      /** The private-message channel created in OPPO's console, for higher delivery limits */
      OPPO_PUSH_CHANNEL_ID: z.string().optional(),
      OPPO_PUSH_MASTER_SECRET: z.string().optional(),
      /** vivo Push: the app id, key and secret */
      VIVO_PUSH_APP_ID: z.string().optional(),
      VIVO_PUSH_APP_KEY: z.string().optional(),
      VIVO_PUSH_APP_SECRET: z.string().optional(),
      /** The system-message category vivo approved; defaults to `TODO` (something to act on) */
      VIVO_PUSH_CATEGORY: z.string().optional(),
      /** Xiaomi Push: the AppSecret */
      XIAOMI_PUSH_APP_SECRET: z.string().optional(),
      /** The private-message channel id registered with Xiaomi, for higher delivery limits */
      XIAOMI_PUSH_CHANNEL_ID: z.string().optional(),
    },
  });
};

export const pushEnv = getPushConfig();
