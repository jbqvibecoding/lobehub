import debug from 'debug';

import { getLarkFamilyConfig, type MessengerLarkConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import {
  type DecryptedMessengerInstallation,
  MessengerInstallationModel,
} from '@/database/models/messengerInstallation';

import { larkTenantKey, readLarkEvent } from '../platforms/lark/events';
import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:lark');

type LarkPlatform = MessengerLarkConfig['platform'];

export const larkInstallationKey = (platform: LarkPlatform, tenantKey: string) =>
  `${platform}:${tenantKey}`;

const tenantOf = (platform: LarkPlatform, installationKey: string) =>
  installationKey.startsWith(`${platform}:`) ? installationKey.slice(platform.length + 1) : null;

/**
 * A Lark install has no token of its own: tenant tokens are minted from the app ticket when needed
 * (see `platforms/lark/tokens`), so `botToken` stays empty and nothing secret is stored per tenant.
 */
const toCredentials = (
  platform: LarkPlatform,
  row: DecryptedMessengerInstallation,
): InstallationCredentials => ({
  applicationId: row.applicationId,
  botToken: '',
  installationKey: larkInstallationKey(platform, row.tenantId),
  metadata: row.metadata ?? {},
  platform,
  tenantId: row.tenantId,
});

const findInstall = async (config: MessengerLarkConfig, tenantKey: string) =>
  MessengerInstallationModel.findByTenant(
    await getServerDB(),
    config.platform,
    tenantKey,
    config.appId,
  );

/** Records (or re-activates) a tenant's install of the store app. */
export const recordLarkInstall = async (
  config: MessengerLarkConfig,
  install: { installedByOpenId?: string; tenantKey: string; tenantName?: string },
): Promise<InstallationCredentials> => {
  const row = await MessengerInstallationModel.upsert(await getServerDB(), {
    applicationId: config.appId,
    credentials: {},
    installedByPlatformUserId: install.installedByOpenId ?? null,
    metadata: install.tenantName ? { tenantName: install.tenantName } : {},
    platform: config.platform,
    tenantId: install.tenantKey,
  });
  log('recorded %s install for tenant=%s', config.platform, install.tenantKey);
  return toCredentials(config.platform, { ...row, credentials: {} });
};

export const revokeLarkInstall = async (config: MessengerLarkConfig, tenantKey: string) => {
  const row = await findInstall(config, tenantKey);
  if (!row) return;
  await MessengerInstallationModel.markRevoked(await getServerDB(), row.id);
  log('revoked install for tenant=%s', tenantKey);
};

/** Installs of the Lark or the Feishu store app; the two are separate apps. */
export class LarkInstallationStore implements MessengerInstallationStore {
  constructor(private readonly platform: LarkPlatform = 'lark') {}

  /**
   * Lark delivers events only from tenants that have the app installed, and the webhook gate has
   * already authenticated this one, so a tenant whose install event was missed (for instance,
   * installed before this endpoint existed) is recorded on its first message.
   */
  async resolveByPayload(req: Request, rawBody: string): Promise<InstallationCredentials | null> {
    const config = await getLarkFamilyConfig(this.platform);
    if (!config) return null;

    const read = readLarkEvent(req.headers, rawBody, config);
    if (!read.ok) return null;
    const tenantKey = larkTenantKey(read.body);
    if (!tenantKey) return null;

    const row = await findInstall(config, tenantKey);
    if (row) return toCredentials(this.platform, row);
    return recordLarkInstall(config, { tenantKey });
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    const tenantKey = tenantOf(this.platform, installationKey);
    const config = await getLarkFamilyConfig(this.platform);
    if (!tenantKey || !config) return null;

    const row = await findInstall(config, tenantKey);
    return row ? toCredentials(this.platform, row) : null;
  }

  async markRevoked(installationKey: string): Promise<void> {
    const tenantKey = tenantOf(this.platform, installationKey);
    const config = await getLarkFamilyConfig(this.platform);
    if (!tenantKey || !config) return;
    await revokeLarkInstall(config, tenantKey);
  }
}
