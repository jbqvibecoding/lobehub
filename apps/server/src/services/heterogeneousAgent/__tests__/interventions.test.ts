// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messagePlugins, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestUser } from '@/server/routers/lambda/__tests__/integration/setup';
import { answerToolApproval, ToolApprovalError } from '@/server/services/toolApproval';

import {
  abortHeteroInterventions,
  settleHeteroIntervention,
  trackHeteroInterventions,
} from '../interventions';

const mocks = vi.hoisted(() => ({
  execAgent: vi.fn(),
  notify: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@/server/services/approvalNotification', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyPendingApprovals: mocks.notify,
}));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({ publishStreamEvent: mocks.publish }),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: mocks.execAgent })),
}));

let db: LobeChatDatabase;

/** A Claude Code run's tool call, as the persistence handler stores it. */
const ccCall = async (apiName: string, toolCallId: string) => {
  const userId = await createTestUser(db);
  const [agent] = await db.insert(agents).values({ title: 'Coder', userId }).returning();
  const [topic] = await db
    .insert(topics)
    .values({ agentId: agent.id, title: 'Fix the build', userId })
    .returning();
  const id = `tool-${toolCallId}-${userId}`;
  await db.insert(messages).values({
    agentId: agent.id,
    content: '',
    id,
    role: 'tool',
    topicId: topic.id,
    userId,
  });
  await db.insert(messagePlugins).values({
    apiName,
    arguments: '{"questions":[{"question":"Which branch?","header":"Branch","options":[]}]}',
    id,
    identifier: 'claude-code',
    toolCallId,
    type: 'default',
    userId,
  });
  return { agentId: agent.id, toolMessageId: id, topicId: topic.id, userId };
};

const interventionOf = async (id: string) =>
  (await db.select().from(messagePlugins).where(eq(messagePlugins.id, id)))[0].intervention;

const ask = (call: Awaited<ReturnType<typeof ccCall>>, toolCallId: string) =>
  trackHeteroInterventions(db, {
    events: [{ data: { toolCallId }, type: 'agent_intervention_request' }],
    operationId: 'op-cc',
    topicId: call.topicId,
    userId: call.userId,
  });

beforeEach(async () => {
  db = await getTestDB();
  mocks.notify.mockReset().mockResolvedValue(undefined);
  mocks.publish.mockReset().mockResolvedValue('1');
  mocks.execAgent.mockReset();
});

describe('a Claude Code question', () => {
  it('waits in the phone’s list, with a push that has no Approve button', async () => {
    const call = await ccCall('askUserQuestion', 'toolu_q1');

    await ask(call, 'toolu_q1');

    expect(await interventionOf(call.toolMessageId)).toEqual({
      operationId: 'op-cc',
      status: 'pending',
    });
    expect(mocks.notify).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actions: false,
        agentId: call.agentId,
        pendingTools: [{ apiName: 'askUserQuestion', id: 'toolu_q1', identifier: 'claude-code' }],
        topicId: call.topicId,
        userId: call.userId,
      }),
    );
  });

  it('is answered on the run’s stream, once, and starts no new run', async () => {
    const call = await ccCall('askUserQuestion', 'toolu_q2');
    await ask(call, 'toolu_q2');

    await expect(
      answerToolApproval(db, { ...call, decision: 'approved', via: 'mobile' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const answer = { 'Which branch?': 'main' };
    await expect(
      answerToolApproval(db, { ...call, answer, decision: 'approved', via: 'mobile' }),
    ).resolves.toEqual({ operationId: 'op-cc' });
    expect(mocks.publish).toHaveBeenCalledWith('op-cc', {
      data: { result: answer, toolCallId: 'toolu_q2' },
      stepIndex: 0,
      type: 'agent_intervention_response',
    });
    expect(mocks.execAgent).not.toHaveBeenCalled();
    expect((await interventionOf(call.toolMessageId))?.status).toBe('approved');

    await expect(
      answerToolApproval(db, { ...call, answer, decision: 'approved', via: 'mobile' }),
    ).rejects.toBeInstanceOf(ToolApprovalError);
  });

  it('can be declined, which the run sees as cancelled with the reason', async () => {
    const call = await ccCall('pushChanges', 'toolu_p1');
    await ask(call, 'toolu_p1');
    expect(mocks.notify.mock.calls[0][1].actions).toBe(true);

    await answerToolApproval(db, {
      ...call,
      decision: 'rejected',
      reason: 'Not on main',
      via: 'mobile',
    });

    expect(mocks.publish.mock.calls[0][1].data).toEqual({
      cancelReason: 'user_cancelled',
      cancelled: true,
      reason: 'Not on main',
      toolCallId: 'toolu_p1',
    });
  });

  it('stops waiting when the sandbox gives up or the run ends', async () => {
    const timedOut = await ccCall('askUserQuestion', 'toolu_t1');
    await ask(timedOut, 'toolu_t1');
    await trackHeteroInterventions(db, {
      events: [
        {
          data: { cancelReason: 'timeout', toolCallId: 'toolu_t1' },
          type: 'agent_intervention_response',
        },
      ],
      operationId: 'op-cc',
      topicId: timedOut.topicId,
      userId: timedOut.userId,
    });
    expect((await interventionOf(timedOut.toolMessageId))?.status).toBe('aborted');

    const ended = await ccCall('askUserQuestion', 'toolu_e1');
    await ask(ended, 'toolu_e1');
    await abortHeteroInterventions(db, ended.userId, 'op-other');
    expect((await interventionOf(ended.toolMessageId))?.status).toBe('pending');
    await abortHeteroInterventions(db, ended.userId, 'op-cc');
    expect((await interventionOf(ended.toolMessageId))?.status).toBe('aborted');
  });

  it('is settled by its owner only, when answered elsewhere', async () => {
    const call = await ccCall('askUserQuestion', 'toolu_s1');
    await ask(call, 'toolu_s1');
    const stranger = await createTestUser(db);

    expect(await settleHeteroIntervention(db, stranger, 'toolu_s1', 'approved')).toBe(false);
    expect(await settleHeteroIntervention(db, call.userId, 'toolu_s1', 'approved')).toBe(true);
    expect(await settleHeteroIntervention(db, call.userId, 'toolu_s1', 'approved')).toBe(false);
  });

  it('ignores an intervention whose tool call it cannot find, and other people’s', async () => {
    const call = await ccCall('askUserQuestion', 'toolu_x1');
    const stranger = await createTestUser(db);

    await trackHeteroInterventions(db, {
      events: [{ data: { toolCallId: 'toolu_x1' }, type: 'agent_intervention_request' }],
      operationId: 'op-cc',
      topicId: call.topicId,
      userId: stranger,
    });

    expect(await interventionOf(call.toolMessageId)).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
