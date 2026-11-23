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
  declinePush: vi.fn(),
  execAgent: vi.fn(),
  notify: vi.fn(),
  pendingPush: vi.fn(),
  publish: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/server/services/githubApp', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GithubConnectionService: vi.fn().mockImplementation(() => ({
    declinePush: mocks.declinePush,
    pendingPush: mocks.pendingPush,
    push: mocks.push,
  })),
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
  mocks.pendingPush.mockReset().mockResolvedValue(undefined);
  mocks.push.mockReset();
  mocks.declinePush.mockReset();
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
      result: { reason: 'Not on main' },
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

describe('a push the coding run asks for', () => {
  const pending = {
    baseRef: 'main',
    baseSha: 'a'.repeat(40),
    body: '',
    branch: 'biber/add-a-readme-abc123',
    files: [{ content: 'eA==', path: 'README.md', status: 'added' }],
    operationId: 'op-cc',
    repository: 'acme/app',
    title: 'Add a README',
  };

  it('shows on the phone what the server holds, not what the run said', async () => {
    const call = await ccCall('pushChanges', 'toolu_push1');
    mocks.pendingPush.mockResolvedValue(pending);

    await ask(call, 'toolu_push1');

    const [row] = await db
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, call.toolMessageId));
    expect(JSON.parse(row.arguments!)).toEqual({
      branch: 'biber/add-a-readme-abc123',
      files: 'README.md (added)',
      pullRequest: 'Add a README',
      repository: 'acme/app',
    });
    expect(mocks.notify.mock.calls[0][1].actions).toBe(true);
  });

  it('is pushed on approval, and the run is told where', async () => {
    const call = await ccCall('pushChanges', 'toolu_push2');
    mocks.pendingPush.mockResolvedValue(pending);
    await ask(call, 'toolu_push2');
    mocks.push.mockResolvedValue({
      branch: pending.branch,
      commit: 'c'.repeat(40),
      pullRequestUrl: 'https://github.com/acme/app/pull/5',
    });

    await answerToolApproval(db, { ...call, decision: 'approved', via: 'mobile' });

    expect(mocks.push).toHaveBeenCalledWith('toolu_push2');
    expect(mocks.publish.mock.calls[0][1].data).toEqual({
      result: {
        branch: pending.branch,
        commit: 'c'.repeat(40),
        pullRequestUrl: 'https://github.com/acme/app/pull/5',
      },
      toolCallId: 'toolu_push2',
    });
  });

  it('tells the run when the approved push failed, and drops a declined one', async () => {
    const failed = await ccCall('pushChanges', 'toolu_push3');
    await ask(failed, 'toolu_push3');
    mocks.push.mockRejectedValue(new Error('Reference already exists'));

    await answerToolApproval(db, { ...failed, decision: 'approved', via: 'mobile' });
    expect(mocks.publish.mock.calls[0][1].data).toMatchObject({
      cancelled: true,
      result: { reason: 'The push failed: Reference already exists' },
    });

    const declined = await ccCall('pushChanges', 'toolu_push4');
    await ask(declined, 'toolu_push4');
    await answerToolApproval(db, { ...declined, decision: 'rejected', via: 'mobile' });
    expect(mocks.declinePush).toHaveBeenCalledWith('toolu_push4');
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
