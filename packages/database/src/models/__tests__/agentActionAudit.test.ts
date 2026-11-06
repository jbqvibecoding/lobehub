import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentActionAuditModel } from '../../models/agentActionAudit';
import { agentActionAudits } from '../../schemas/agentActionAudit';
import { topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'audit-user';
const otherUserId = 'audit-other-user';

const event = (overrides: Partial<Parameters<AgentActionAuditModel['record']>[0]> = {}) => ({
  apiName: 'send_email',
  callDigest: 'digest-1',
  eventType: 'succeeded' as const,
  identifier: 'gmail-mcp',
  toolCallId: 'call-1',
  toolClass: 'sensitive' as const,
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentActionAuditModel', () => {
  it('lists only the user’s own events, newest first, page by page', async () => {
    const model = new AgentActionAuditModel(serverDB, userId);
    const first = await model.record(event({ eventType: 'approval_requested' }));
    await new AgentActionAuditModel(serverDB, otherUserId).record(event());
    const second = await model.record(event({ eventType: 'approved', payload: { via: 'mobile' } }));
    const third = await model.record(event({ eventType: 'succeeded' }));

    const page = await model.list({ limit: 2 });
    expect(page.map((row) => row.id)).toEqual([third.id, second.id]);
    expect(page[1].payload).toEqual({ via: 'mobile' });

    const next = await model.list({ cursor: page[1].id, limit: 2 });
    expect(next.map((row) => row.id)).toEqual([first.id]);
  });

  it('keeps the trail when the conversation it describes is deleted', async () => {
    const model = new AgentActionAuditModel(serverDB, userId);
    await serverDB.insert(topics).values({ id: 'topic-audited', userId });
    await model.record(event({ topicId: 'topic-audited' }));

    await serverDB.delete(topics);

    expect(await model.list()).toHaveLength(1);
  });

  it('goes with the account', async () => {
    await new AgentActionAuditModel(serverDB, userId).record(event());

    await serverDB.delete(users);

    expect(await serverDB.select().from(agentActionAudits)).toEqual([]);
  });
});
