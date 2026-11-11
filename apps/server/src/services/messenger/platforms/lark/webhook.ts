import debug from 'debug';

import { getLarkFamilyConfig, type MessengerLarkConfig } from '@/config/messenger';

import {
  larkInstallationKey,
  recordLarkInstall,
  revokeLarkInstall,
} from '../../installations/lark';
import type { MessengerPlatformWebhookGate } from '../types';
import { readLarkEvent } from './events';
import { getLarkTenantName } from './tenant';
import { saveLarkAppTicket } from './tokens';

const log = debug('lobe-server:messenger:lark:webhook');

const ok = () => Response.json({ ok: true });

const recordInstall = async (
  config: MessengerLarkConfig,
  install: { installedByOpenId?: string; tenantKey: string },
) =>
  recordLarkInstall(config, {
    ...install,
    tenantName: await getLarkTenantName(config, install.tenantKey),
  });

/**
 * Authenticates every Lark delivery, answers the setup challenge, and handles the store app's
 * lifecycle events here, since none of them belongs to a chat: the hourly app ticket, a tenant
 * installing the app, stopping or restarting it, and uninstalling it. Message events go on to the
 * install lookup and the Chat SDK adapter.
 */
export const larkWebhookGate = (
  platform: MessengerLarkConfig['platform'],
): MessengerPlatformWebhookGate => ({
  preprocess: async (req, rawBody, ctx) => {
    const config = await getLarkFamilyConfig(platform);
    if (!config) return new Response(`${platform} is not configured`, { status: 503 });

    const read = readLarkEvent(req.headers, rawBody, config);
    if (!read.ok) {
      log('rejected a delivery: %s', read.reason);
      return new Response(read.reason, { status: 401 });
    }
    const { body } = read;

    if (body.type === 'url_verification') return Response.json({ challenge: body.challenge });

    const event = body.type === 'event_callback' ? body.event : undefined;
    const tenantKey: string | undefined = event?.tenant_key;

    switch (event?.type) {
      case 'app_ticket': {
        await saveLarkAppTicket(platform, event.app_ticket);
        return ok();
      }
      case 'app_open': {
        if (tenantKey) {
          await recordInstall(config, {
            installedByOpenId: event.installer?.open_id ?? event.installer_employee?.open_id,
            tenantKey,
          });
        }
        return ok();
      }
      case 'app_status_change': {
        if (!tenantKey) return ok();
        if (String(event.status).startsWith('stop')) {
          await revokeLarkInstall(config, tenantKey);
          ctx.invalidateBot(larkInstallationKey(platform, tenantKey));
        } else {
          await recordInstall(config, { tenantKey });
        }
        return ok();
      }
      case 'app_uninstalled': {
        if (tenantKey) {
          await revokeLarkInstall(config, tenantKey);
          ctx.invalidateBot(larkInstallationKey(platform, tenantKey));
        }
        return ok();
      }
    }

    return null;
  },
});
