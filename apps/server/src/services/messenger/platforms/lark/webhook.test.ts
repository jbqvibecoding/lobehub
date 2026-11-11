// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessengerLarkConfig } from '@/config/messenger';

import { recordLarkInstall, revokeLarkInstall } from '../../installations/lark';
import { getLarkTenantName } from './tenant';
import { saveLarkAppTicket } from './tokens';
import { larkWebhookGate } from './webhook';

vi.mock('@/config/messenger', () => ({ getMessengerLarkConfig: vi.fn() }));
vi.mock('../../installations/lark', () => ({
  larkInstallationKey: (tenantKey: string) => `lark:${tenantKey}`,
  recordLarkInstall: vi.fn(),
  revokeLarkInstall: vi.fn(),
}));
vi.mock('./tokens', () => ({ saveLarkAppTicket: vi.fn() }));
vi.mock('./tenant', () => ({ getLarkTenantName: vi.fn() }));

const config = { appId: 'cli_app', appSecret: 's', verificationToken: 'verify-token' };
const invalidateBot = vi.fn();

const deliver = (body: Record<string, unknown>) =>
  larkWebhookGate.preprocess(
    new Request('https://app.example.com/api/agent/messenger/webhooks/lark', { method: 'POST' }),
    JSON.stringify({ token: 'verify-token', ...body }),
    { invalidateBot },
  );

const lifecycle = (event: Record<string, unknown>) =>
  deliver({ event: { app_id: 'cli_app', ...event }, type: 'event_callback' });

beforeEach(() => {
  vi.mocked(getMessengerLarkConfig).mockResolvedValue(config);
  vi.mocked(getLarkTenantName).mockResolvedValue('Acme');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('larkWebhookGate', () => {
  it('refuses deliveries that do not carry the verification token', async () => {
    const res = await deliver({ token: 'forged', type: 'url_verification', challenge: 'x' });

    expect(res?.status).toBe(401);
  });

  it('answers the setup challenge', async () => {
    const res = await deliver({ challenge: 'c-123', type: 'url_verification' });

    expect(await res?.json()).toEqual({ challenge: 'c-123' });
  });

  it('keeps the hourly app ticket', async () => {
    const res = await lifecycle({ app_ticket: 'ticket-9', type: 'app_ticket' });

    expect(res?.status).toBe(200);
    expect(saveLarkAppTicket).toHaveBeenCalledWith('ticket-9');
  });

  it('records a tenant installing the app, with its name and installer', async () => {
    await lifecycle({
      installer: { open_id: 'ou_admin' },
      tenant_key: 'tenant-a',
      type: 'app_open',
    });

    expect(recordLarkInstall).toHaveBeenCalledWith(config, {
      installedByOpenId: 'ou_admin',
      tenantKey: 'tenant-a',
      tenantName: 'Acme',
    });
  });

  it('stops serving a tenant that stops or uninstalls the app', async () => {
    await lifecycle({
      status: 'stop_by_tenant',
      tenant_key: 'tenant-a',
      type: 'app_status_change',
    });
    await lifecycle({ tenant_key: 'tenant-b', type: 'app_uninstalled' });

    expect(revokeLarkInstall).toHaveBeenCalledWith(config, 'tenant-a');
    expect(revokeLarkInstall).toHaveBeenCalledWith(config, 'tenant-b');
    expect(invalidateBot).toHaveBeenCalledWith('lark:tenant-a');
    expect(invalidateBot).toHaveBeenCalledWith('lark:tenant-b');
  });

  it('serves a tenant again once it restarts the app', async () => {
    await lifecycle({
      status: 'start_by_tenant',
      tenant_key: 'tenant-a',
      type: 'app_status_change',
    });

    expect(recordLarkInstall).toHaveBeenCalledWith(config, {
      tenantKey: 'tenant-a',
      tenantName: 'Acme',
    });
    expect(revokeLarkInstall).not.toHaveBeenCalled();
  });

  it('passes message events on to the install lookup and the adapter', async () => {
    const res = await deliver({
      header: {
        event_type: 'im.message.receive_v1',
        tenant_key: 'tenant-a',
        token: 'verify-token',
      },
      schema: '2.0',
    });

    expect(res).toBeNull();
  });
});
