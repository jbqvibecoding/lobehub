// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentActionAuditModel } from '@/database/models/agentActionAudit';

import { createTestUser } from '../../lambda/__tests__/integration/setup';
import { activityRouter } from '../activity';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const record = (userId: string, toolCallId: string) =>
  new AgentActionAuditModel(testDB, userId).record({
    apiName: 'send_email',
    callDigest: `digest-${toolCallId}`,
    eventType: 'succeeded',
    identifier: 'gmail-mcp',
    toolCallId,
    toolClass: 'sensitive',
  });

describe('mobile activityRouter', () => {
  const callerFor = (userId: string) =>
    activityRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  beforeEach(async () => {
    testDB = await getTestDB();
  });

  it("pages through the user's own trail, newest first", async () => {
    const owner = await createTestUser(testDB);
    const stranger = await createTestUser(testDB);
    for (const id of ['call-1', 'call-2', 'call-3']) await record(owner, id);
    await record(stranger, 'call-theirs');

    const first = await callerFor(owner).list({ limit: 2 });
    expect(first.items.map((item) => item.toolCallId)).toEqual(['call-3', 'call-2']);
    expect(first.nextCursor).toBe(first.items[1].id);

    const second = await callerFor(owner).list({ cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((item) => item.toolCallId)).toEqual(['call-1']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('rejects a cursor that is not an event id', async () => {
    const owner = await createTestUser(testDB);

    await expect(callerFor(owner).list({ cursor: 'not-an-id' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
