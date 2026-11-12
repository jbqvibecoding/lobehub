// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';

import { issueLinkToken } from '../../../linkTokenStore';
import { MessengerWechatBinder } from '../binder';
import { SECRETS } from './fixtures';

const { sendText } = vi.hoisted(() => ({ sendText: vi.fn() }));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.biber.test' } }));
vi.mock('@/config/messenger', () => ({
  getMessengerWechatConfig: async () => ({ ...SECRETS, appSecret: 'secret' }),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: { findByPlatformUser: vi.fn() },
}));
vi.mock('../../../linkTokenStore', () => ({ issueLinkToken: vi.fn() }));
vi.mock('../api', () => ({ createWechatMpApi: () => ({ sendText }) }));

beforeEach(() => {
  vi.mocked(issueLinkToken).mockResolvedValue('rand-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerWechatBinder', () => {
  it('answers an unlinked follower with the link that connects their account', async () => {
    await new MessengerWechatBinder().handleUnlinkedMessage({
      authorUserId: 'oAlice',
      chatId: 'oAlice',
    });

    expect(issueLinkToken).toHaveBeenCalledWith({ platform: 'wechat', platformUserId: 'oAlice' });
    const [openId, text] = sendText.mock.calls[0];
    expect(openId).toBe('oAlice');
    const link = new URL(text.match(/https:\/\/\S+/)[0]);
    expect(link.pathname).toBe('/verify-im');
    expect(Object.fromEntries(link.searchParams)).toMatchObject({
      im_type: 'wechat',
      im_user_id: 'oAlice',
      random_id: 'rand-1',
    });
  });

  it('greets a returning follower who is linked, and starts linking one who is not', async () => {
    const binder = new MessengerWechatBinder();
    vi.mocked(MessengerAccountLinkModel.findByPlatformUser).mockResolvedValueOnce({
      id: 'link-1',
    } as any);
    await binder.greet('oLinked');
    expect(sendText).toHaveBeenLastCalledWith('oLinked', expect.stringContaining('欢迎回来'));
    expect(issueLinkToken).not.toHaveBeenCalled();

    vi.mocked(MessengerAccountLinkModel.findByPlatformUser).mockResolvedValueOnce(undefined);
    await binder.greet('oNew');
    expect(issueLinkToken).toHaveBeenCalledWith({ platform: 'wechat', platformUserId: 'oNew' });
    expect(sendText).toHaveBeenLastCalledWith('oNew', expect.stringContaining('/verify-im'));
  });

  it('confirms the link to the follower, naming the active agent', async () => {
    await new MessengerWechatBinder().notifyLinkSuccess({
      activeAgentName: '日程助理',
      platformUserId: 'oAlice',
    });

    expect(sendText).toHaveBeenCalledWith('oAlice', expect.stringContaining('当前助理：日程助理'));
  });
});
