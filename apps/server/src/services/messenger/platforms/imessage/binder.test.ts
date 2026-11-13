// @vitest-environment node
import { createLinqAdapter } from '@linqapp/chat-sdk-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessengerImessageConfig } from '@/config/messenger';

import { issueLinkToken } from '../../linkTokenStore';
import { MessengerImessageBinder } from './binder';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/config/messenger', () => ({ getMessengerImessageConfig: vi.fn() }));
vi.mock('../../linkTokenStore', () => ({ issueLinkToken: vi.fn() }));
vi.mock('@linqapp/chat-sdk-adapter', () => ({ createLinqAdapter: vi.fn() }));

const postMessage = vi.fn();
const openDM = vi.fn();

beforeEach(() => {
  postMessage.mockResolvedValue({ id: 'msg-1', threadId: 'linq:chat-1' });
  openDM.mockImplementation(async (handle: string) => `linq:pending:${handle}`);
  vi.mocked(createLinqAdapter).mockReturnValue({
    openDM,
    parseMessage: vi.fn(),
    postMessage,
  } as any);
  vi.mocked(getMessengerImessageConfig).mockResolvedValue({
    apiKey: 'linq-key',
    phoneNumber: '+12025550100',
    signingSecret: 'whsec_test',
  });
  vi.mocked(issueLinkToken).mockResolvedValue('rand-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerImessageBinder', () => {
  it('has no client while the line is not configured', async () => {
    vi.mocked(getMessengerImessageConfig).mockResolvedValueOnce(null);

    expect(await new MessengerImessageBinder().createClient()).toBeNull();
  });

  it('answers an unlinked sender in their chat with a link to connect their account', async () => {
    await new MessengerImessageBinder().handleUnlinkedMessage({
      authorUserId: '+12025550147',
      chatId: 'chat-1',
    });

    expect(issueLinkToken).toHaveBeenCalledWith({
      platform: 'imessage',
      platformUserId: '+12025550147',
      platformUsername: undefined,
    });
    const [threadId, text] = postMessage.mock.calls[0];
    expect(threadId).toBe('linq:chat-1');
    const link = new URL(text.match(/https:\/\/\S+/)[0]);
    expect(link.pathname).toBe('/verify-im');
    expect(link.searchParams.get('im_type')).toBe('imessage');
    expect(link.searchParams.get('im_user_id')).toBe('+12025550147');
    expect(link.searchParams.get('random_id')).toBe('rand-1');
  });

  it('tells the sender to retry when no link can be issued', async () => {
    vi.mocked(issueLinkToken).mockRejectedValueOnce(new Error('redis down'));

    await new MessengerImessageBinder().handleUnlinkedMessage({
      authorUserId: '+12025550147',
      chatId: 'chat-1',
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][1]).toMatch(/temporarily unavailable/);
    expect(postMessage.mock.calls[0][1]).not.toMatch(/verify-im/);
  });

  it('confirms the link to the handle that linked, naming the active agent', async () => {
    await new MessengerImessageBinder().notifyLinkSuccess({
      activeAgentName: 'Travel planner',
      platformUserId: 'someone@icloud.com',
    });

    expect(openDM).toHaveBeenCalledWith('someone@icloud.com');
    expect(postMessage).toHaveBeenCalledWith(
      'linq:pending:someone@icloud.com',
      expect.stringContaining('Active agent: Travel planner'),
    );
  });

  it('does not throw when a reply cannot be delivered', async () => {
    postMessage.mockRejectedValueOnce(new Error('Linq 503'));

    await expect(
      new MessengerImessageBinder().sendDmText('chat-1', 'No active agent selected.'),
    ).resolves.toBeUndefined();
  });
});
