import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'pending-interventions-user';
const otherUserId = 'pending-interventions-other';
const messageModel = new MessageModel(serverDB, userId);

const toolMessage = (
  id: string,
  owner: string,
  status: 'approved' | 'pending' | 'rejected',
  createdAt: string,
) => ({
  message: {
    agentId: owner === userId ? 'agent-1' : 'agent-other',
    content: '',
    createdAt: new Date(createdAt),
    id,
    role: 'tool',
    topicId: owner === userId ? 'topic-1' : 'topic-other',
    userId: owner,
  },
  plugin: {
    apiName: 'send_email',
    arguments: '{"to":"ana@example.com"}',
    id,
    identifier: 'gmail-mcp',
    intervention: { status },
    toolCallId: `call-${id}`,
    type: 'mcp',
    userId: owner,
  },
});

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await trx.insert(agents).values([
      { id: 'agent-1', title: 'Assistant', userId },
      { id: 'agent-other', title: 'Other', userId: otherUserId },
    ]);
    await trx.insert(topics).values([
      { agentId: 'agent-1', id: 'topic-1', userId },
      { agentId: 'agent-other', id: 'topic-other', userId: otherUserId },
    ]);

    const rows = [
      toolMessage('older-pending', userId, 'pending', '2026-11-05T10:00:00Z'),
      toolMessage('newer-pending', userId, 'pending', '2026-11-05T11:00:00Z'),
      toolMessage('approved', userId, 'approved', '2026-11-05T12:00:00Z'),
      toolMessage('rejected', userId, 'rejected', '2026-11-05T12:30:00Z'),
      toolMessage('someone-elses', otherUserId, 'pending', '2026-11-05T13:00:00Z'),
    ];
    await trx.insert(messages).values(rows.map((row) => row.message));
    await trx.insert(messagePlugins).values(rows.map((row) => row.plugin));
  });
});

describe('MessageModel.listPendingInterventions', () => {
  it("lists only the user's own pending tool calls, newest first, with their conversation", async () => {
    const pending = await messageModel.listPendingInterventions();

    expect(pending.map((item) => item.id)).toEqual(['newer-pending', 'older-pending']);
    expect(pending[0]).toMatchObject({
      agentId: 'agent-1',
      apiName: 'send_email',
      arguments: '{"to":"ana@example.com"}',
      identifier: 'gmail-mcp',
      toolCallId: 'call-newer-pending',
      topicId: 'topic-1',
      type: 'mcp',
    });
  });

  it('stops at the limit', async () => {
    expect(await messageModel.listPendingInterventions(1)).toHaveLength(1);
  });
});

describe('MessageModel.claimPendingIntervention', () => {
  it('lets only the first of two answers through', async () => {
    const [first, second] = await Promise.all([
      messageModel.claimPendingIntervention('newer-pending', 'approved'),
      messageModel.claimPendingIntervention('newer-pending', 'rejected'),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
    expect((await messageModel.listPendingInterventions()).map((item) => item.id)).toEqual([
      'older-pending',
    ]);
  });

  it('does not answer tool calls that are settled or belong to someone else', async () => {
    expect(await messageModel.claimPendingIntervention('approved', 'rejected')).toBe(false);
    expect(await messageModel.claimPendingIntervention('someone-elses', 'approved')).toBe(false);

    const [row] = await serverDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, 'someone-elses'));
    expect(row.intervention).toEqual({ status: 'pending' });
  });
});
