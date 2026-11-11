// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessengerLarkConfig } from '@/config/messenger';

import { issueLinkToken } from '../../linkTokenStore';
import { MessengerLarkBinder } from './binder';
import { larkTenantApi } from './tenant';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/config/messenger', () => ({ getMessengerLarkConfig: vi.fn() }));
vi.mock('../../linkTokenStore', () => ({ issueLinkToken: vi.fn() }));
vi.mock('./tenant', () => ({ larkTenantApi: vi.fn() }));
vi.mock('../../installations', () => ({ getInstallationStore: vi.fn() }));
vi.mock('@/server/services/bot/platforms/feishu/client', () => ({
  createLarkStoreAppClient: vi.fn(() => ({ id: 'lark-client' })),
}));

const config = { appId: 'cli_app', appSecret: 's', verificationToken: 'verify-token' };
const creds = {
  applicationId: 'cli_app',
  botToken: '',
  installationKey: 'lark:tenant-a',
  metadata: { tenantName: 'Acme' },
  platform: 'lark' as const,
  tenantId: 'tenant-a',
};

const api = { sendMessage: vi.fn(), sendMessageToUser: vi.fn() };

beforeEach(() => {
  vi.mocked(getMessengerLarkConfig).mockResolvedValue(config);
  vi.mocked(larkTenantApi).mockReturnValue(api as any);
  vi.mocked(issueLinkToken).mockResolvedValue('rand-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerLarkBinder', () => {
  it('sends the account link to the person privately, scoped to their tenant', async () => {
    await new MessengerLarkBinder(creds).handleUnlinkedMessage({
      authorUserId: 'ou_alice',
      authorUserName: 'Alice',
      channelMentionThreadId: 'lark:group:oc_team',
      chatId: 'oc_team',
    });

    expect(issueLinkToken).toHaveBeenCalledWith({
      platform: 'lark',
      platformUserId: 'ou_alice',
      platformUsername: 'Alice',
      tenantId: 'tenant-a',
      tenantName: 'Acme',
    });
    expect(larkTenantApi).toHaveBeenCalledWith(config, 'tenant-a');
    expect(api.sendMessage).not.toHaveBeenCalled();
    const [openId, text] = api.sendMessageToUser.mock.calls[0];
    expect(openId).toBe('ou_alice');
    const link = new URL(text.match(/https:\/\/\S+/)[0]);
    expect(link.searchParams.get('im_type')).toBe('lark');
    expect(link.searchParams.get('random_id')).toBe('rand-1');
  });

  it('answers a group command privately instead of in the group', async () => {
    await new MessengerLarkBinder(creds).replyEphemeral({
      channelId: 'oc_team',
      text: 'No active agent selected.',
      userId: 'ou_alice',
    });

    expect(api.sendMessageToUser).toHaveBeenCalledWith('ou_alice', 'No active agent selected.');
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('has no client without a configured app or a tenant install', async () => {
    expect(await new MessengerLarkBinder().createClient()).toBeNull();
    vi.mocked(getMessengerLarkConfig).mockResolvedValueOnce(null);
    expect(await new MessengerLarkBinder(creds).createClient()).toBeNull();
  });
});
