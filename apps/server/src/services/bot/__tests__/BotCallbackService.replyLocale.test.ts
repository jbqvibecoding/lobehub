import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotCallbackBody } from '../BotCallbackService';
import { BotCallbackService } from '../BotCallbackService';

/**
 * The language the bot answers a chat in follows Biber's rule (`messengerReplyLocale`): the
 * mainland edition and the WeChat Official Account answer in Chinese. Kept apart from
 * `BotCallbackService.test.ts`, which is at the file-size limit.
 */

const { mockEditMessage, region } = vi.hoisted(() => ({
  mockEditMessage: vi.fn().mockResolvedValue(undefined),
  region: { APP_REGION: 'global' },
}));

vi.mock('@/envs/region', () => ({ regionEnv: region }));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: {
    findByPlatformAndAppId: vi.fn().mockResolvedValue({ credentials: '{}', settings: {} }),
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return { findById: vi.fn().mockResolvedValue(undefined), update: vi.fn() };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi
      .fn()
      .mockResolvedValue({ decrypt: vi.fn().mockResolvedValue({ plaintext: '{}' }) }),
  },
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));
vi.mock('../AgentBridgeService', () => ({
  AgentBridgeService: { clearActiveThread: vi.fn() },
}));
vi.mock('../BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ replayDeferredMessages: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/server/services/messenger/MessengerRouter', () => ({
  getMessengerRouter: () => ({ replayDeferredMessages: vi.fn() }),
}));
vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({ isEnabled: false }),
}));
vi.mock('@/server/services/messenger/installations', () => ({
  getInstallationStore: vi.fn(),
  messengerConnectionIdForUser: vi.fn(),
}));
vi.mock('@/server/services/messenger/platforms', () => ({
  messengerPlatformRegistry: { createBinder: vi.fn(), getPlatform: vi.fn() },
}));
vi.mock('../wake/scheduler', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  recordWakeRunOutcome: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../platforms', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const client = {
    extractChatId: (id: string) => id,
    getMessenger: () => ({
      createMessage: vi.fn().mockResolvedValue(undefined),
      editMessage: mockEditMessage,
      removeReaction: vi.fn(),
      replaceReaction: vi.fn(),
      triggerTyping: vi.fn(),
    }),
  };
  return {
    ...actual,
    platformRegistry: {
      getPlatform: () => ({ clientFactory: { createClient: () => client }, schema: [] }),
    },
  };
});

/** A run paused for approval, reported to a chat whose sender is not the bot's owner. */
const paused = (platformThreadId: string): BotCallbackBody => ({
  applicationId: 'app-1',
  isOwner: false,
  operationId: 'op-1',
  platformThreadId,
  progressMessageId: 'progress-1',
  reason: 'waiting_for_human',
  topicId: 'topic-1',
  type: 'completion',
  userId: 'user-1',
});

describe('BotCallbackService reply language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    region.APP_REGION = 'global';
  });

  it('answers a Telegram chat in English in the international edition', async () => {
    await new BotCallbackService({} as any).handleCallback(paused('telegram:42'));

    expect(mockEditMessage).toHaveBeenCalledWith(
      'progress-1',
      "⏸ Waiting for the owner's approval.",
    );
  });

  it('answers the WeChat Official Account in Chinese', async () => {
    await new BotCallbackService({} as any).handleCallback(paused('wechatmp:openid-1'));

    expect(mockEditMessage).toHaveBeenCalledWith('progress-1', '⏸ 正在等机器人主人批准。');
  });

  it('answers every chat in Chinese in the mainland edition', async () => {
    region.APP_REGION = 'cn';

    await new BotCallbackService({} as any).handleCallback(paused('telegram:42'));

    expect(mockEditMessage).toHaveBeenCalledWith('progress-1', '⏸ 正在等机器人主人批准。');
  });
});
