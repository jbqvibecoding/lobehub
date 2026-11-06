// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messagePlugins, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestUser } from '@/server/routers/lambda/__tests__/integration/setup';

import { answerToolApproval, ToolApprovalError } from '../index';

const { mockExecAgent, mockQueueMode } = vi.hoisted(() => ({
  mockExecAgent: vi.fn(),
  mockQueueMode: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: mockExecAgent })),
}));
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: mockQueueMode,
}));

const telegramChat = {
  applicationId: 'messenger-telegram',
  isOwner: true,
  messengerInstallationKey: 'telegram:singleton',
  platform: 'telegram',
  platformThreadId: 'telegram:4242',
  senderExternalUserId: '4242',
};

let db: LobeChatDatabase;

const pendingCallIn = async (bot?: typeof telegramChat) => {
  const userId = await createTestUser(db);
  const [agent] = await db.insert(agents).values({ title: 'Assistant', userId }).returning();
  const [topic] = await db
    .insert(topics)
    .values({ agentId: agent.id, metadata: bot ? { bot } : undefined, title: 'Trip', userId })
    .returning();
  await db.insert(messages).values({
    agentId: agent.id,
    content: '',
    id: `tool-${userId}`,
    role: 'tool',
    topicId: topic.id,
    userId,
  });
  await db.insert(messagePlugins).values({
    apiName: 'send_email',
    arguments: '{"to":"ana@example.com"}',
    id: `tool-${userId}`,
    identifier: 'gmail-mcp',
    intervention: { status: 'pending' },
    toolCallId: 'call-1',
    type: 'mcp',
    userId,
  });
  return { toolMessageId: `tool-${userId}`, topicId: topic.id, userId };
};

beforeEach(async () => {
  db = await getTestDB();
  mockExecAgent.mockReset();
  mockExecAgent.mockResolvedValue({ operationId: 'op-resumed' });
  mockQueueMode.mockReturnValue(true);
});

describe('answerToolApproval', () => {
  it('resumes a chat-started run so its reply goes back to that chat', async () => {
    const { toolMessageId, userId } = await pendingCallIn(telegramChat);

    await answerToolApproval(db, {
      chatMessageId: '77',
      decision: 'approved',
      toolMessageId,
      userId,
      via: 'telegram',
    });

    const params = mockExecAgent.mock.calls[0][0];
    expect(params).toMatchObject({
      botContext: telegramChat,
      resumeApproval: { decision: 'approved', toolCallId: 'call-1', via: 'telegram' },
      trigger: 'bot',
      userInterventionConfig: { approvalMode: 'manual' },
    });
    expect(params.hooks.map((hook: any) => [hook.type, hook.webhook.body.type])).toEqual([
      ['afterStep', 'step'],
      ['onComplete', 'completion'],
    ]);
    expect(params.hooks[1].webhook.body).toMatchObject({
      isOwner: true,
      messengerInstallationKey: 'telegram:singleton',
      platformThreadId: 'telegram:4242',
      progressMessageId: '77',
      userId,
    });
  });

  it('leaves delivery to the runtime when there is no chat to report to', async () => {
    const inApp = await pendingCallIn();
    await answerToolApproval(db, { ...inApp, decision: 'rejected', via: 'mobile' });

    mockQueueMode.mockReturnValue(false);
    const local = await pendingCallIn(telegramChat);
    await answerToolApproval(db, { ...local, decision: 'approved', via: 'mobile' });

    expect(mockExecAgent.mock.calls.map(([params]) => params.hooks)).toEqual([
      undefined,
      undefined,
    ]);
    expect(mockExecAgent.mock.calls[0][0].trigger).toBe('chat');
  });

  it('takes only the first answer', async () => {
    const { toolMessageId, userId } = await pendingCallIn(telegramChat);
    await answerToolApproval(db, { decision: 'approved', toolMessageId, userId, via: 'telegram' });

    await expect(
      answerToolApproval(db, { decision: 'rejected', toolMessageId, userId, via: 'mobile' }),
    ).rejects.toEqual(new ToolApprovalError('CONFLICT', 'This tool call was already answered'));
    expect(mockExecAgent).toHaveBeenCalledTimes(1);
  });
});
