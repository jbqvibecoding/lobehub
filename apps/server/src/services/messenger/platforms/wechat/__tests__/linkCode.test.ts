// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { answerWechatLinkCode, startWechatLinkCode } from '../linkCode';

const store = new Map<string, string>();
const redis = {
  del: vi.fn(async (key: string) => store.delete(key)),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
};
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redis,
}));

const mockUpsert = vi.fn();
const mockModel = vi.fn();
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation((...args: unknown[]) => {
    mockModel(...args);
    return { upsertForPlatform: mockUpsert };
  }),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({ db: true }) }));

const link = {
  activeAgentId: 'agent-1',
  activeAgentName: 'Biber',
  userId: 'user-1',
  workspaceId: null,
};

beforeEach(() => {
  store.clear();
  mockUpsert.mockResolvedValue({ id: 'link-1' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WeChat link codes', () => {
  it('links the WeChat that sends the code the web page showed', async () => {
    const code = await startWechatLinkCode('o_alice', link);

    expect(code).toMatch(/^\d{6}$/);
    expect(redis.set).toHaveBeenCalledWith(
      'messenger:wechat-link-code:o_alice',
      expect.any(String),
      'EX',
      600,
    );
    expect(await answerWechatLinkCode('o_alice', ` ${code} `)).toEqual({
      activeAgentName: 'Biber',
      status: 'linked',
    });
    expect(mockModel).toHaveBeenCalledWith({ db: true }, 'user-1');
    expect(mockUpsert).toHaveBeenCalledWith({
      activeAgentId: 'agent-1',
      platform: 'wechat',
      platformUserId: 'o_alice',
      platformUsername: null,
      tenantId: '',
      workspaceId: null,
    });
    // One use only
    expect(await answerWechatLinkCode('o_alice', code)).toEqual({ status: 'none' });
  });

  it('does not link another WeChat that sends the same code', async () => {
    const code = await startWechatLinkCode('o_alice', link);

    expect(await answerWechatLinkCode('o_mallory', code)).toEqual({ status: 'none' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('asks again for anything that is not a six-digit code', async () => {
    await startWechatLinkCode('o_alice', link);

    expect(await answerWechatLinkCode('o_alice', 'hello')).toEqual({ status: 'waiting' });
    expect(await answerWechatLinkCode('o_alice', undefined)).toEqual({ status: 'waiting' });
  });

  it('drops the link after five wrong codes', async () => {
    const code = await startWechatLinkCode('o_alice', link);
    const wrong = code === '000000' ? '111111' : '000000';

    for (const attemptsLeft of [4, 3, 2, 1]) {
      expect(await answerWechatLinkCode('o_alice', wrong)).toEqual({
        attemptsLeft,
        status: 'wrong',
      });
    }
    expect(await answerWechatLinkCode('o_alice', wrong)).toEqual({ status: 'tooManyAttempts' });
    expect(await answerWechatLinkCode('o_alice', code)).toEqual({ status: 'none' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('reports a link that could not be written', async () => {
    const code = await startWechatLinkCode('o_alice', link);
    mockUpsert.mockRejectedValue(new Error('already linked elsewhere'));

    expect(await answerWechatLinkCode('o_alice', code)).toEqual({ status: 'failed' });
  });
});
