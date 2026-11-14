// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  messagePlugins,
  messages,
  pushTokens,
  tasks,
  taskTopics,
  topics,
  userSettings,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestUser } from '@/server/routers/lambda/__tests__/integration/setup';

import { BACKGROUND_APPROVAL_TTL_MS } from '../background';
import { expireBackgroundApprovals, NO_ANSWER_REASON } from '../expire';
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

const pendingCallIn = async (
  bot?: typeof telegramChat,
  { askedAt, trigger }: { askedAt?: Date; trigger?: string } = {},
) => {
  const userId = await createTestUser(db);
  const [agent] = await db.insert(agents).values({ title: 'Assistant', userId }).returning();
  const [topic] = await db
    .insert(topics)
    .values({
      agentId: agent.id,
      metadata: bot ? { bot } : undefined,
      title: 'Trip',
      trigger,
      userId,
    })
    .returning();
  await db.insert(messages).values({
    agentId: agent.id,
    content: '',
    createdAt: askedAt,
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

    expect(mockExecAgent.mock.calls[0][0].hooks).toBeUndefined();
    expect(mockExecAgent.mock.calls[0][0].trigger).toBe('chat');
  });

  it('reports a resumed chat run to the chat when runs are not queued too', async () => {
    mockQueueMode.mockReturnValue(false);
    const local = await pendingCallIn(telegramChat);
    await answerToolApproval(db, { ...local, decision: 'approved', via: 'mobile' });

    const { hooks } = mockExecAgent.mock.calls[0][0];
    expect(hooks.map((hook: any) => hook.id)).toEqual(['bot-step-progress', 'bot-completion']);
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

/** A task whose scheduled run paused on this call, as `TaskRunnerService.runTask` leaves it. */
const pendingCallInTask = async (options: { askedAt?: Date } = {}) => {
  const call = await pendingCallIn(undefined, { ...options, trigger: 'task' });
  const [task] = await db
    .insert(tasks)
    .values({
      createdByUserId: call.userId,
      identifier: 'T-1',
      instruction: 'Send the weekly report',
      seq: 1,
      status: 'running',
    })
    .returning();
  await db.insert(taskTopics).values({
    operationId: 'op-paused',
    seq: 1,
    taskId: task.id,
    topicId: call.topicId,
    trigger: 'schedule',
    userId: call.userId,
  });
  return { ...call, taskId: task.id };
};

describe('answerToolApproval for a task run', () => {
  it('settles the task when the resumed run ends, and lets the task be stopped meanwhile', async () => {
    const { taskId, toolMessageId, topicId, userId } = await pendingCallInTask();

    await answerToolApproval(db, { decision: 'approved', toolMessageId, userId, via: 'mobile' });

    const { hooks } = mockExecAgent.mock.calls[0][0];
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatchObject({
      id: 'task-on-complete',
      type: 'onComplete',
      webhook: { body: { runTrigger: 'schedule', taskId, taskIdentifier: 'T-1', userId } },
    });
    const [row] = await db.select().from(taskTopics).where(eq(taskTopics.topicId, topicId));
    expect(row.operationId).toBe('op-resumed');
  });

  it('keeps asking the phone for later calls in the run', async () => {
    const { toolMessageId, userId } = await pendingCallInTask();
    await db
      .insert(pushTokens)
      .values({ deviceId: 'phone', expoToken: 'ExponentPushToken[x]', platform: 'ios', userId });

    await answerToolApproval(db, { decision: 'approved', toolMessageId, userId, via: 'mobile' });

    expect(mockExecAgent.mock.calls[0][0].userInterventionConfig).toEqual({
      approvalMode: 'manual',
    });
  });

  it('runs later calls unattended once no phone is left to ask', async () => {
    const { toolMessageId, userId } = await pendingCallInTask();

    await answerToolApproval(db, { decision: 'approved', toolMessageId, userId, via: 'web' });

    expect(mockExecAgent.mock.calls[0][0].userInterventionConfig).toEqual({
      approvalMode: 'headless',
    });
  });

  it('follows the approval mode and always-allow list the user saved', async () => {
    const { toolMessageId, userId } = await pendingCallInTask();
    await db
      .insert(pushTokens)
      .values({ deviceId: 'phone', expoToken: 'ExponentPushToken[x]', platform: 'ios', userId });
    await db.insert(userSettings).values({
      id: userId,
      tool: {
        humanIntervention: { allowList: ['gmail-mcp/send_email'], approvalMode: 'allow-list' },
      },
    });

    await answerToolApproval(db, { decision: 'approved', toolMessageId, userId, via: 'mobile' });

    expect(mockExecAgent.mock.calls[0][0].userInterventionConfig).toEqual({
      allowList: ['gmail-mcp/send_email'],
      approvalMode: 'allow-list',
    });
  });
});

describe('expireBackgroundApprovals', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const longAgo = new Date(now.getTime() - BACKGROUND_APPROVAL_TTL_MS - 60_000);
  const recently = new Date(now.getTime() - 60_000);

  it('refuses a background request nobody answered in time, which resumes and settles its run', async () => {
    const { taskId, toolMessageId, userId } = await pendingCallInTask({ askedAt: longAgo });

    const result = await expireBackgroundApprovals(db, now);

    expect(result).toMatchObject({ expired: 1, failed: 0 });
    expect(mockExecAgent).toHaveBeenCalledTimes(1);
    expect(mockExecAgent.mock.calls[0][0]).toMatchObject({
      parentMessageId: toolMessageId,
      resumeApproval: { decision: 'rejected', rejectionReason: NO_ANSWER_REASON, via: 'timeout' },
    });
    expect(mockExecAgent.mock.calls[0][0].hooks[0].webhook.body).toMatchObject({ taskId, userId });
    const [plugin] = await db
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, toolMessageId));
    expect(plugin.intervention).toEqual({ status: 'rejected' });
  });

  it('leaves recent requests and requests in chats waiting', async () => {
    await pendingCallInTask({ askedAt: recently });
    await pendingCallIn(undefined, { askedAt: longAgo, trigger: 'chat' });
    await pendingCallIn(telegramChat, { askedAt: longAgo });

    const result = await expireBackgroundApprovals(db, now);

    expect(result.found).toBe(0);
    expect(mockExecAgent).not.toHaveBeenCalled();
  });

  it('closes a request that has no run to resume, so later sweeps skip it', async () => {
    const { toolMessageId } = await pendingCallIn(undefined, { askedAt: longAgo, trigger: 'cron' });
    await db
      .update(messagePlugins)
      .set({ toolCallId: null })
      .where(eq(messagePlugins.id, toolMessageId));

    expect(await expireBackgroundApprovals(db, now)).toMatchObject({ expired: 0, failed: 1 });
    expect(await expireBackgroundApprovals(db, now)).toMatchObject({ found: 0 });
  });
});
