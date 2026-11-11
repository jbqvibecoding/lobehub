import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import debug from 'debug';

import type { MessengerLarkConfig } from '@/config/messenger';

import { getLarkTenantAccessToken } from './tokens';

const log = debug('lobe-server:messenger:lark:tenant');

export const larkTenantApi = (config: MessengerLarkConfig, tenantKey: string) =>
  new LarkApiClient(config.appId, config.appSecret, config.platform, () =>
    getLarkTenantAccessToken(config, tenantKey),
  );

/** The tenant's display name, when the app may read it; never blocks an install on failure. */
export const getLarkTenantName = async (
  config: MessengerLarkConfig,
  tenantKey: string,
): Promise<string | undefined> => {
  try {
    return (await larkTenantApi(config, tenantKey).getTenantInfo())?.name || undefined;
  } catch (error) {
    log('tenant name unavailable for %s: %O', tenantKey, error);
    return undefined;
  }
};
