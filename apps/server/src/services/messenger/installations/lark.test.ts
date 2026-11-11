// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessengerLarkConfig } from '@/config/messenger';

import { LarkInstallationStore, recordLarkInstall } from './lark';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => testDB) }));
vi.mock('@/config/messenger', () => ({ getMessengerLarkConfig: vi.fn() }));

const config = { appId: 'cli_app', appSecret: 's', verificationToken: 'verify-token' };

const messageFrom = (tenantKey: string, token = 'verify-token') =>
  new Request('https://app.example.com/api/agent/messenger/webhooks/lark', {
    body: JSON.stringify({
      header: { event_type: 'im.message.receive_v1', tenant_key: tenantKey, token },
      schema: '2.0',
    }),
    method: 'POST',
  });

const resolve = async (store: LarkInstallationStore, req: Request) =>
  store.resolveByPayload(req, await req.clone().text());

describe('LarkInstallationStore', () => {
  beforeEach(async () => {
    testDB = await getTestDB();
    vi.mocked(getMessengerLarkConfig).mockResolvedValue(config);
  });

  it("resolves a recorded tenant's install for its messages", async () => {
    await recordLarkInstall(config, { tenantKey: 'tenant-a', tenantName: 'Acme' });

    const creds = await resolve(new LarkInstallationStore(), messageFrom('tenant-a'));

    expect(creds).toMatchObject({
      installationKey: 'lark:tenant-a',
      metadata: { tenantName: 'Acme' },
      platform: 'lark',
      tenantId: 'tenant-a',
    });
  });

  it('records a tenant on its first message when its install event was missed', async () => {
    const store = new LarkInstallationStore();

    expect(await store.resolveByKey('lark:tenant-new')).toBeNull();
    await resolve(store, messageFrom('tenant-new'));

    expect(await store.resolveByKey('lark:tenant-new')).toMatchObject({ tenantId: 'tenant-new' });
  });

  it('records nothing for an unauthenticated delivery', async () => {
    const store = new LarkInstallationStore();

    expect(await resolve(store, messageFrom('tenant-x', 'forged'))).toBeNull();
    expect(await store.resolveByKey('lark:tenant-x')).toBeNull();
  });

  it('stops resolving a revoked tenant until it installs again', async () => {
    const store = new LarkInstallationStore();
    await recordLarkInstall(config, { tenantKey: 'tenant-a' });

    await store.markRevoked('lark:tenant-a');
    expect(await store.resolveByKey('lark:tenant-a')).toBeNull();

    await recordLarkInstall(config, { tenantKey: 'tenant-a' });
    expect(await store.resolveByKey('lark:tenant-a')).toMatchObject({ tenantId: 'tenant-a' });
  });
});
