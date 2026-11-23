// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Shared in-memory stream backing both procedures. The remote HITL loop only
// touches `publishStreamEvent` (browser leg) + `readEventsOnce` (exec leg), so a
// tiny store-backed stub of the factory is enough to exercise the round-trip
// without a live Redis. An unknown `lastEventId` reads from the start (mirrors
// Redis `XREAD 0`); `'$'` means from-now.
const { store } = vi.hoisted(() => ({ store: { events: [] as any[], seq: 0 } }));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({
    async publishStreamEvent(operationId: string, event: any) {
      const id = String(++store.seq);
      store.events.push({ ...event, id, operationId });
      return id;
    },
    async readEventsOnce(operationId: string, lastEventId = '$') {
      const all = store.events.filter((e) => e.operationId === operationId);
      if (lastEventId === '$') return { events: [], lastEventId: all.at(-1)?.id ?? '0' };
      const idx = all.findIndex((e) => e.id === lastEventId);
      const events = idx >= 0 ? all.slice(idx + 1) : all.slice();
      return { events, lastEventId: events.at(-1)?.id ?? lastEventId };
    },
  }),
}));

// Services constructed by the aiAgentProcedure / heteroAgentProcedure middleware
// — stub so the test stays isolated from their real deps.
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));
const hetero = vi.hoisted(() => ({ exportFile: vi.fn(), finish: vi.fn(), ingest: vi.fn() }));
vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: vi.fn(() => ({ exportAndUploadFile: hetero.exportFile })),
}));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/market', () => ({ MarketService: vi.fn() }));
vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi
    .fn()
    .mockImplementation(() => ({ heteroFinish: hetero.finish, heteroIngest: hetero.ingest })),
}));

describe('aiAgentRouter — remote Human-in-the-loop', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    store.events.length = 0;
    store.seq = 0;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  // Browser leg: user JWT.
  const userCaller = () => aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);
  // Exec leg: hetero-operation JWT (server-minted, ownership-exempt).
  const heteroCaller = () =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId },
      oidcAuth: { purpose: 'hetero-operation', sub: userId },
      userId,
    } as any);
  // Exec leg via an owner OIDC token (a desktop reusing its own session): a
  // normal token whose `purpose` is NOT `hetero-operation` → heteroAuthKind
  // resolves to 'user', so the ownership guard applies.
  const ownerTokenCaller = (sub: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId: sub },
      oidcAuth: { sub },
      userId: sub,
    } as any);

  const insertOperation = async (id: string, ownerId: string) => {
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agentOperations).values({ id, status: 'running', userId: ownerId });
  };

  it('submit → wait round-trips a structured answer, filtered to the response', async () => {
    await userCaller().submitHeteroIntervention({
      operationId: 'op-1',
      result: { 'Which env?': 'prod' },
      toolCallId: 't1',
    });

    const res = await heteroCaller().waitInterventionResponse({
      lastEventId: '0',
      operationId: 'op-1',
    });

    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe('agent_intervention_response');
    expect(res.events[0].data).toMatchObject({
      result: { 'Which env?': 'prod' },
      toolCallId: 't1',
    });
    expect(res.events[0].data.cancelled).toBeUndefined();
  });

  it('cancel clears the result and defaults the reason', async () => {
    await userCaller().submitHeteroIntervention({
      cancelled: true,
      operationId: 'op-1',
      result: { should: 'be dropped' },
      toolCallId: 't2',
    });

    const res = await heteroCaller().waitInterventionResponse({
      lastEventId: '0',
      operationId: 'op-1',
    });

    expect(res.events[0].data).toMatchObject({
      cancelReason: 'user_cancelled',
      cancelled: true,
      toolCallId: 't2',
    });
    expect(res.events[0].data.result).toBeUndefined();
  });

  it('waitInterventionResponse ignores non-intervention events on the stream', async () => {
    // A plain stream event lands on the op's stream but is not an answer.
    store.events.push({
      data: {},
      id: String(++store.seq),
      operationId: 'op-1',
      stepIndex: 0,
      type: 'stream_chunk',
    });

    const res = await heteroCaller().waitInterventionResponse({
      lastEventId: '0',
      operationId: 'op-1',
    });

    expect(res.events).toHaveLength(0);
  });

  describe('waitInterventionResponse ownership guard', () => {
    it('lets an owner token read its own operation', async () => {
      await insertOperation('op-owned', userId);
      await userCaller().submitHeteroIntervention({
        operationId: 'op-owned',
        result: { answer: 'yes' },
        toolCallId: 't-own',
      });

      const res = await ownerTokenCaller(userId).waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-owned',
      });

      expect(res.events).toHaveLength(1);
      expect(res.events[0].data).toMatchObject({ toolCallId: 't-own' });
    });

    it("rejects an owner token reading another user's operation", async () => {
      const otherUserId = await createTestUser(serverDB);
      await insertOperation('op-others', otherUserId);
      // The victim's answer lands on the stream…
      await aiAgentRouter
        .createCaller({ jwtPayload: { userId: otherUserId }, userId: otherUserId } as any)
        .submitHeteroIntervention({
          operationId: 'op-others',
          result: { secret: 'leak me' },
          toolCallId: 't-victim',
        });

      // …but a different signed-in user must not be able to long-poll it.
      await expect(
        ownerTokenCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-others',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await cleanupTestUser(serverDB, otherUserId);
    });

    it('rejects an owner token for an unknown operation id', async () => {
      await expect(
        ownerTokenCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-missing',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('exempts the server-minted operation token from the ownership lookup', async () => {
      // No agent_operations row exists for this id; the operation-token path
      // must still succeed (it's trusted as server-minted).
      const res = await heteroCaller().waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-no-row',
      });

      expect(res.events).toHaveLength(0);
    });
  });

  describe('run tokens (hetero-run) report only their own run', () => {
    const runCaller = (op: string, topic: string) =>
      aiAgentRouter.createCaller({
        jwtPayload: { userId },
        oidcAuth: { op, purpose: 'hetero-run', sub: userId, topic },
      } as any);

    const ownTopic = async () => {
      const { topics } = await import('@/database/schemas');
      await serverDB.insert(topics).values({ id: 'tpc-run', title: 'Run', userId });
      return 'tpc-run';
    };

    const ingest = (caller: ReturnType<typeof runCaller>, operationId: string, topicId: string) =>
      caller.heteroIngest({
        agentType: 'claude-code',
        events: [
          { data: {}, operationId, stepIndex: 0, timestamp: Date.now(), type: 'stream_chunk' },
        ],
        operationId,
        topicId,
      } as any);

    it('streams its own run back', async () => {
      const topicId = await ownTopic();

      await expect(ingest(runCaller('op-run', topicId), 'op-run', topicId)).resolves.toEqual({
        ack: true,
      });
      await runCaller('op-run', topicId).heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-run',
        result: 'success',
        topicId,
      });

      expect(hetero.ingest).toHaveBeenCalledTimes(1);
      expect(hetero.finish).toHaveBeenCalledTimes(1);
    });

    it('is refused for another run, another conversation, or a topic not its user’s', async () => {
      const topicId = await ownTopic();
      const caller = runCaller('op-run', topicId);

      await expect(ingest(caller, 'op-other', topicId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(ingest(caller, 'op-run', 'tpc-other')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller.heteroFinish({
          agentType: 'claude-code',
          operationId: 'op-other',
          result: 'success',
          topicId,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.waitInterventionResponse({ lastEventId: '0', operationId: 'op-other' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // Scoped to a conversation that is not this user's
      await expect(
        ingest(runCaller('op-x', 'tpc-missing'), 'op-x', 'tpc-missing'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(hetero.ingest).not.toHaveBeenCalled();
      expect(hetero.finish).not.toHaveBeenCalled();
    });

    it('reads the answers to its own run’s questions', async () => {
      await userCaller().submitHeteroIntervention({
        operationId: 'op-run',
        result: { answer: 'yes' },
        toolCallId: 't-run',
      });

      const res = await runCaller('op-run', 'tpc-run').waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-run',
      });

      expect(res.events[0].data).toMatchObject({ toolCallId: 't-run' });
    });
  });

  it('refuses an answer to someone else’s run', async () => {
    const otherUserId = await createTestUser(serverDB);
    await insertOperation('op-not-mine', otherUserId);

    await expect(
      userCaller().submitHeteroIntervention({
        operationId: 'op-not-mine',
        result: { answer: 'yes' },
        toolCallId: 't-x',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.events).toHaveLength(0);
    await cleanupTestUser(serverDB, otherUserId);
  });

  describe('heteroDeliverFile', () => {
    const runCaller = (op: string, topic: string) =>
      aiAgentRouter.createCaller({
        jwtPayload: { userId },
        oidcAuth: { op, purpose: 'hetero-run', sub: userId, topic },
      } as any);

    beforeEach(async () => {
      hetero.exportFile.mockReset();
      const { topics } = await import('@/database/schemas');
      await serverDB.insert(topics).values({ id: 'tpc-file', title: 'Report', userId });
    });

    it('stores the run’s file from the coding computer and returns what the card shows', async () => {
      hetero.exportFile.mockResolvedValue({
        fileId: 'file-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1234,
        success: true,
        url: '/f/file-1',
      });

      const file = await runCaller('op-file', 'tpc-file').heteroDeliverFile({
        operationId: 'op-file',
        path: '/workspace/out/report.pdf',
        topicId: 'tpc-file',
      });

      expect(file).toEqual({
        fileId: 'file-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1234,
        url: '/f/file-1',
      });
      expect(hetero.exportFile).toHaveBeenCalledWith('/workspace/out/report.pdf', 'report.pdf');
      const { createSandboxService } = await import('@/server/services/sandbox');
      expect(createSandboxService).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'coding', topicId: 'tpc-file', userId }),
      );
    });

    it('tells the run why a file was refused', async () => {
      hetero.exportFile.mockResolvedValue({
        error: { message: '/workspace/out/empty.pdf is empty (0 bytes).' },
        filename: 'empty.pdf',
        success: false,
      });

      await expect(
        runCaller('op-file', 'tpc-file').heteroDeliverFile({
          operationId: 'op-file',
          path: '/workspace/out/empty.pdf',
          topicId: 'tpc-file',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('empty') });
    });

    it('is only for a run’s own token, for its own run', async () => {
      const input = { operationId: 'op-file', path: '/workspace/a.pdf', topicId: 'tpc-file' };

      await expect(
        runCaller('op-other', 'tpc-file').heteroDeliverFile(input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(heteroCaller().heteroDeliverFile(input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(ownerTokenCaller(userId).heteroDeliverFile(input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(hetero.exportFile).not.toHaveBeenCalled();
    });
  });
});
