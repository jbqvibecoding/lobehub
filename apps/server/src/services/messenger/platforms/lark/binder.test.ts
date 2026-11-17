// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLarkFamilyConfig } from '@/config/messenger';

import { issueLinkToken } from '../../linkTokenStore';
import { MessengerLarkBinder } from './binder';
import { larkTenantApi } from './tenant';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/config/messenger', () => ({ getLarkFamilyConfig: vi.fn() }));
vi.mock('../../linkTokenStore', () => ({ issueLinkToken: vi.fn() }));
vi.mock('./tenant', () => ({ larkTenantApi: vi.fn() }));
vi.mock('./tokens', () => ({ getLarkTenantAccessToken: vi.fn(async () => 'tenant-token') }));
vi.mock('../../installations', () => ({ getInstallationStore: vi.fn() }));
vi.mock('@/server/services/bot/platforms/feishu/client', () => ({
  createLarkStoreAppClient: vi.fn(() => ({ id: 'lark-client' })),
}));

const config = {
  appId: 'cli_app',
  appSecret: 's',
  platform: 'lark' as const,
  verificationToken: 'verify-token',
};
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
  vi.mocked(getLarkFamilyConfig).mockResolvedValue(config);
  vi.mocked(larkTenantApi).mockReturnValue(api as any);
  vi.mocked(issueLinkToken).mockResolvedValue('rand-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerLarkBinder', () => {
  it('sends the account link to the person privately, scoped to their tenant', async () => {
    await new MessengerLarkBinder('lark', creds).handleUnlinkedMessage({
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
    await new MessengerLarkBinder('lark', creds).replyEphemeral({
      channelId: 'oc_team',
      text: 'No active agent selected.',
      userId: 'ou_alice',
    });

    expect(api.sendMessageToUser).toHaveBeenCalledWith('ou_alice', 'No active agent selected.');
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('has no client without a configured app or a tenant install', async () => {
    expect(await new MessengerLarkBinder('lark').createClient()).toBeNull();
    vi.mocked(getLarkFamilyConfig).mockResolvedValueOnce(null);
    expect(await new MessengerLarkBinder('lark', creds).createClient()).toBeNull();
  });
});

describe('MessengerLarkBinder approvals', () => {
  const tapBody = (value: object, overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      event: {
        action: { tag: 'button', value },
        context: { open_chat_id: 'oc_dm', open_message_id: 'om_card' },
        operator: { open_id: 'ou_alice' },
        token: 'c-tap-1',
      },
      header: { event_type: 'card.action.trigger', tenant_key: 'tenant-a', token: 'verify-token' },
      schema: '2.0',
      ...overrides,
    });
  const post = (body: string) =>
    new Request('https://app.example.com/api/agent/messenger/webhooks/lark', {
      body,
      method: 'POST',
    });

  it('sends the request as a card with Approve / Reject buttons, using the tenant token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ code: 0, data: { message_id: 'om_1' } }));

    await new MessengerLarkBinder('lark', creds).sendApprovalRequest('oc_dm', {
      approvals: [{ toolMessageId: 'tool_1' }],
      labels: { approve: 'Approve', reject: 'Reject' },
      text: '⏸ Waiting for your approval\n\nSend email · gmail',
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tenant-token');
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ msg_type: 'interactive', receive_id: 'oc_dm' });
    const card = JSON.parse(sent.content);
    expect(card.elements[0].text).toEqual({
      content: '⏸ Waiting for your approval\n\nSend email · gmail',
      tag: 'plain_text',
    });
    expect(card.elements[1].actions.map((b: any) => [b.text.content, b.value.action])).toEqual([
      ['Approve', 'messenger:approve:tool_1'],
      ['Reject', 'messenger:reject:tool_1'],
    ]);
    fetchSpy.mockRestore();
  });

  it('reads a tap on one of its buttons from an authenticated delivery', async () => {
    const action = await new MessengerLarkBinder('lark', creds).extractCallbackAction(
      post(tapBody({ action: 'messenger:approve:tool_1' })),
    );

    expect(action).toEqual({
      callbackId: 'c-tap-1',
      chatId: 'oc_dm',
      data: 'messenger:approve:tool_1',
      fromUserId: 'ou_alice',
    });
  });

  it('ignores taps with a wrong token, and buttons that are not its own', async () => {
    const binder = new MessengerLarkBinder('lark', creds);
    const forged = tapBody(
      { action: 'messenger:approve:tool_1' },
      {
        header: { event_type: 'card.action.trigger', tenant_key: 'tenant-a', token: 'nope' },
      },
    );

    expect(await binder.extractCallbackAction(post(forged))).toBeNull();
    expect(await binder.extractCallbackAction(post(tapBody({ action: 'other' })))).toBeNull();
  });

  it('answers a tap in the reply: a toast, and the card replaced by its outcome', async () => {
    const reply = await new MessengerLarkBinder('lark', creds).acknowledgeCallback(
      { callbackId: 'c', chatId: 'oc_dm', data: 'messenger:approve:tool_1', fromUserId: 'ou' },
      { replaceText: 'Approved.', toast: 'Approved.' },
    );

    expect(await reply.json()).toEqual({
      card: {
        data: {
          config: { update_multi: true },
          elements: [{ tag: 'div', text: { content: 'Approved.', tag: 'plain_text' } }],
        },
        type: 'raw',
      },
      toast: { content: 'Approved.', type: 'info' },
    });
  });
});

describe('MessengerLarkBinder language', () => {
  it('invites a Feishu user in Chinese and a Lark user in English', async () => {
    vi.mocked(getLarkFamilyConfig).mockResolvedValue({ ...config, platform: 'feishu' });
    await new MessengerLarkBinder('feishu', { ...creds, platform: 'feishu' }).handleUnlinkedMessage(
      { authorUserId: 'ou_alice', chatId: 'oc_dm' },
    );
    expect(api.sendMessageToUser.mock.calls[0][1]).toMatch(/^欢迎使用 Biber！[\s\S]*飞书账号/);

    vi.mocked(getLarkFamilyConfig).mockResolvedValue(config);
    await new MessengerLarkBinder('lark', creds).handleUnlinkedMessage({
      authorUserId: 'ou_bob',
      chatId: 'oc_dm',
    });
    expect(api.sendMessageToUser.mock.calls[1][1]).toMatch(/^Welcome to Biber!/);
  });
});
