import debug from 'debug';

import { getMessengerImessageConfig } from '@/config/messenger';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:imessage');

/**
 * One product-owned iMessage line on Linq serves every user, so like Telegram there is no tenant.
 */
export const IMESSAGE_INSTALLATION_KEY = 'imessage:singleton';

const buildCreds = async (): Promise<InstallationCredentials | null> => {
  const config = await getMessengerImessageConfig();
  if (!config) return null;
  return {
    applicationId: IMESSAGE_INSTALLATION_KEY,
    botToken: config.apiKey,
    installationKey: IMESSAGE_INSTALLATION_KEY,
    metadata: { phoneNumber: config.phoneNumber ?? '' },
    platform: 'imessage',
    signingSecret: config.signingSecret,
    tenantId: '',
  };
};

export class ImessageInstallationStore implements MessengerInstallationStore {
  async resolveByPayload(): Promise<InstallationCredentials | null> {
    const creds = await buildCreds();
    if (!creds) log('resolveByPayload: iMessage line not configured');
    return creds;
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    if (installationKey !== IMESSAGE_INSTALLATION_KEY) return null;
    return buildCreds();
  }
}
