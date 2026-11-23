import debug from 'debug';

import { getMessengerWechatMpConfig } from '@/config/messenger';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:wechat');

/** One product-owned Official Account serves every user, so like Telegram there is no tenant. */
export const WECHAT_MP_INSTALLATION_KEY = 'wechatmp:singleton';

const buildCreds = async (): Promise<InstallationCredentials | null> => {
  const config = await getMessengerWechatMpConfig();
  if (!config) return null;
  return {
    applicationId: config.appId,
    botToken: config.appSecret,
    installationKey: WECHAT_MP_INSTALLATION_KEY,
    metadata: {},
    platform: 'wechatmp',
    signingSecret: config.token,
    tenantId: '',
  };
};

export class WechatMpInstallationStore implements MessengerInstallationStore {
  async resolveByPayload(): Promise<InstallationCredentials | null> {
    const creds = await buildCreds();
    if (!creds) log('resolveByPayload: WeChat Official Account not configured');
    return creds;
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    if (installationKey !== WECHAT_MP_INSTALLATION_KEY) return null;
    return buildCreds();
  }
}
