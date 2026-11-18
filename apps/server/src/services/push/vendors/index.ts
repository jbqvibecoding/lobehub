import { regionalIdentifier } from '@lobechat/region';

import { pushEnv } from '@/envs/push';
import { regionEnv } from '@/envs/region';

import { APNS_ENDPOINTS, createApnsSender } from './apns';
import { createHonorSender } from './honor';
import { createHuaweiSender } from './huawei';
import { createOppoSender } from './oppo';
import type { VendorPushProvider, VendorPushSender } from './types';
import { createVivoSender } from './vivo';
import { createXiaomiSender } from './xiaomi';

export * from './types';

let senders: Partial<Record<VendorPushProvider, VendorPushSender>> | undefined;

/** The phone makers' push services (Apple's included) this deployment has keys for. */
export const vendorPushSenders = (): Partial<Record<VendorPushProvider, VendorPushSender>> => {
  if (senders) return senders;
  const env = pushEnv;
  senders = {};

  if (env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY) {
    senders.apns = createApnsSender({
      // The iOS bundle id of this edition's phone app
      bundleId: regionalIdentifier('ai.biber.app', regionEnv.APP_REGION),
      endpoint: env.APNS_ENDPOINT ?? APNS_ENDPOINTS[env.APNS_ENVIRONMENT ?? 'production'],
      keyId: env.APNS_KEY_ID,
      privateKey: env.APNS_PRIVATE_KEY,
      teamId: env.APNS_TEAM_ID,
    });
  }

  if (env.HUAWEI_PUSH_APP_ID && env.HUAWEI_PUSH_CLIENT_SECRET) {
    senders.huawei = createHuaweiSender({
      appId: env.HUAWEI_PUSH_APP_ID,
      category: env.HUAWEI_PUSH_CATEGORY,
      clientSecret: env.HUAWEI_PUSH_CLIENT_SECRET,
    });
  }
  if (env.HONOR_PUSH_APP_ID && env.HONOR_PUSH_CLIENT_ID && env.HONOR_PUSH_CLIENT_SECRET) {
    senders.honor = createHonorSender({
      appId: env.HONOR_PUSH_APP_ID,
      clientId: env.HONOR_PUSH_CLIENT_ID,
      clientSecret: env.HONOR_PUSH_CLIENT_SECRET,
    });
  }
  if (env.XIAOMI_PUSH_APP_SECRET) {
    senders.xiaomi = createXiaomiSender({
      appSecret: env.XIAOMI_PUSH_APP_SECRET,
      channelId: env.XIAOMI_PUSH_CHANNEL_ID,
      // The Android application id of this edition's phone app
      packageName: regionalIdentifier('ai.biber.app', regionEnv.APP_REGION),
    });
  }
  if (env.OPPO_PUSH_APP_KEY && env.OPPO_PUSH_MASTER_SECRET) {
    senders.oppo = createOppoSender({
      appKey: env.OPPO_PUSH_APP_KEY,
      channelId: env.OPPO_PUSH_CHANNEL_ID,
      masterSecret: env.OPPO_PUSH_MASTER_SECRET,
    });
  }
  if (env.VIVO_PUSH_APP_ID && env.VIVO_PUSH_APP_KEY && env.VIVO_PUSH_APP_SECRET) {
    senders.vivo = createVivoSender({
      appId: env.VIVO_PUSH_APP_ID,
      appKey: env.VIVO_PUSH_APP_KEY,
      appSecret: env.VIVO_PUSH_APP_SECRET,
      category: env.VIVO_PUSH_CATEGORY,
    });
  }
  return senders;
};
