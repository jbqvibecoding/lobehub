// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerRouter } from './index';
import {
  fakeDmThread,
  fakeMessage,
  loadSlackBot,
  mockAnswerToolApproval,
  mockChatBot,
  mockFindLink,
  mockHandleSubscribed,
  mockListPendingInterventions,
  mockSlackBinder,
  MockToolApprovalError,
  resetMessengerRouterMocks,
} from './testUtils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).agentRuntimeRedisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/gateway', async () => (await import('./testUtils')).gatewayEnvModule());
vi.mock('../installations', async () => (await import('./testUtils')).installationsModule());
vi.mock('../oauth/slackOAuth', async () => (await import('./testUtils')).slackOAuthModule());
vi.mock('@/config/messenger', async () => (await import('./testUtils')).messengerConfigModule());
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('@/server/services/bot/AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('@/database/models/agent', async () => (await import('./testUtils')).agentModelModule());
vi.mock('@/database/models/messengerAccountLink', async () =>
  (await import('./testUtils')).messengerAccountLinkModule(),
);
vi.mock('@/database/models/workspace', async () =>
  (await import('./testUtils')).workspaceModelModule(),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('@/database/models/workspaceUserSettings', async () =>
  (await import('./testUtils')).workspaceUserSettingsModule(),
);
vi.mock('@/server/services/resourcePermission', async () =>
  (await import('./testUtils')).resourcePermissionModule(),
);
vi.mock('@/server/services/bot/replyTemplate', async () =>
  (await import('./testUtils')).replyTemplateModule(),
);
vi.mock('../platforms/slack/binder', async () => (await import('./testUtils')).slackBinderModule());
vi.mock('../platforms/telegram/binder', async () =>
  (await import('./testUtils')).telegramBinderModule(),
);
vi.mock('../platforms/wechat/binder', async () =>
  (await import('./testUtils')).wechatBinderModule(),
);
vi.mock('../platforms/linq/binder', async () => (await import('./testUtils')).linqBinderModule());
vi.mock('../platforms/linq/webhook', async () => (await import('./testUtils')).linqWebhookModule());
vi.mock('../platforms/imessage/binder', async () =>
  (await import('./testUtils')).imessageBinderModule(),
);
vi.mock('../platforms/lark/binder', async () => (await import('./testUtils')).larkBinderModule());
vi.mock('../platforms/lark/webhook', async () => (await import('./testUtils')).larkWebhookModule());
vi.mock('@/server/services/toolApproval', async () =>
  (await import('./testUtils')).toolApprovalModule(),
);
vi.mock('@/database/models/message', async () =>
  (await import('./testUtils')).messageModelModule(),
);

beforeEach(() => {
  resetMessengerRouterMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerRouter approval buttons', () => {
  const telegram = { platform: 'telegram', tenantId: '' };
  const tap = (data: string) => ({
    callbackId: 'cb_1',
    chatId: '4242',
    data,
    fromUserId: '4242',
    messageId: 77,
  });
  const tapWith = async (data: string) => {
    const binder = { acknowledgeCallback: vi.fn() };
    await (new MessengerRouter() as any).handleCallbackAction(binder, telegram, tap(data));
    return binder.acknowledgeCallback;
  };

  beforeEach(() => {
    mockAnswerToolApproval.mockReset();
    mockAnswerToolApproval.mockResolvedValue({ operationId: 'op-resumed' });
    mockFindLink.mockResolvedValue({
      id: 'link_1',
      platformUserId: '4242',
      tenantId: '',
      userId: 'user_alice',
      workspaceId: null,
    });
  });

  it("answers the linked user's call and keeps the outcome in place of the buttons", async () => {
    const ack = await tapWith('messenger:approve:msg_tool_1');

    expect(mockAnswerToolApproval).toHaveBeenCalledWith(expect.anything(), {
      chatMessageId: '77',
      decision: 'approved',
      toolMessageId: 'msg_tool_1',
      userId: 'user_alice',
      via: 'telegram',
      workspaceId: undefined,
    });
    expect(ack.mock.calls[0][1]).toEqual({
      replaceText: 'toolApprovalApproved',
      toast: 'toolApprovalApproved',
    });
  });

  it('says so when the call was already answered elsewhere', async () => {
    mockAnswerToolApproval.mockRejectedValue(
      new MockToolApprovalError('CONFLICT', 'This tool call was already answered'),
    );

    const ack = await tapWith('messenger:reject:msg_tool_1');

    expect(mockAnswerToolApproval.mock.calls[0][1].decision).toBe('rejected');
    expect(ack.mock.calls[0][1]).toEqual({
      replaceText: 'toolApprovalAlreadyAnswered',
      toast: 'toolApprovalAlreadyAnswered',
    });
  });

  it("hands back the binder's own reply to the tap, where the platform takes the answer there", async () => {
    const binder = {
      acknowledgeCallback: vi.fn(async (_action, ack) => Response.json({ toast: ack.toast })),
    };

    const reply = await (new MessengerRouter() as any).handleCallbackAction(
      binder,
      { platform: 'lark', tenantId: 'tenant-a' },
      tap('messenger:approve:msg_tool_1'),
    );

    expect(mockAnswerToolApproval.mock.calls[0][1]).toMatchObject({
      decision: 'approved',
      via: 'lark',
    });
    expect(await reply.json()).toEqual({ toast: 'toolApprovalApproved' });
  });

  it('does nothing for a sender who is not linked', async () => {
    mockFindLink.mockResolvedValue(null);

    const ack = await tapWith('messenger:approve:msg_tool_1');

    expect(mockAnswerToolApproval).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][1]).toEqual({ toast: 'Not linked. Send /start first.' });
  });
});

describe('MessengerRouter approval by reply', () => {
  const pendingEmail = {
    apiName: 'send_email',
    arguments: '{"to":"ana@example.com"}',
    id: 'msg_tool_older',
    identifier: 'gmail-mcp',
    topicId: 'topic-1',
  };
  const send = async (text: string, state: any = { topicId: 'topic-1' }) => {
    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler({ ...fakeDmThread(), state: Promise.resolve(state) }, fakeMessage({ text }));
  };

  beforeEach(async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: null,
    });
    mockAnswerToolApproval.mockReset();
    mockAnswerToolApproval.mockResolvedValue({ operationId: 'op-resumed' });
    mockListPendingInterventions.mockReset();
    // Newest first, as the model returns them
    mockListPendingInterventions.mockResolvedValue([
      { ...pendingEmail, apiName: 'delete_file', id: 'msg_tool_newer', identifier: 'drive' },
      pendingEmail,
    ]);
  });

  it('approves the oldest waiting call on "1" and names it in the chat', async () => {
    await send(' 1. ');

    expect(mockListPendingInterventions).toHaveBeenCalledWith({ topicId: 'topic-1' });
    expect(mockAnswerToolApproval).toHaveBeenCalledWith(expect.anything(), {
      decision: 'approved',
      reason: undefined,
      toolMessageId: 'msg_tool_older',
      userId: 'user_alice',
      via: 'slack',
      workspaceId: undefined,
    });
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith(
      'D_DM',
      'approved: Send email · gmail-mcp',
    );
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
  });

  it.each(['2', '２', '拒绝', 'No!'])('rejects on "%s"', async (text) => {
    await send(text);

    expect(mockAnswerToolApproval.mock.calls[0][1]).toMatchObject({
      decision: 'rejected',
      reason: undefined,
    });
  });

  it('refuses the call and passes anything else on to the agent', async () => {
    await send('Don’t email her, text her instead');

    expect(mockAnswerToolApproval.mock.calls[0][1]).toMatchObject({
      decision: 'rejected',
      reason: 'Don’t email her, text her instead',
      toolMessageId: 'msg_tool_older',
    });
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith(
      'D_DM',
      'rejected (redirected): Send email · gmail-mcp',
    );
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
  });

  it('asks again when the message has nothing to read', async () => {
    await send('');

    expect(mockAnswerToolApproval).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', 'toolApprovalReplyOnlyText');
  });

  it('says so when the call was answered elsewhere first', async () => {
    mockAnswerToolApproval.mockRejectedValue(
      new MockToolApprovalError('CONFLICT', 'This tool call was already answered'),
    );

    await send('1');

    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', 'toolApprovalAlreadyAnswered');
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
  });

  it('goes to the agent as usual when nothing waits in this chat', async () => {
    mockListPendingInterventions.mockResolvedValue([]);

    await send('1');

    expect(mockAnswerToolApproval).not.toHaveBeenCalled();
    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
  });

  it('goes to the agent as usual in a chat that has no conversation yet', async () => {
    await send('1', {});

    expect(mockListPendingInterventions).not.toHaveBeenCalled();

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
  });
});
