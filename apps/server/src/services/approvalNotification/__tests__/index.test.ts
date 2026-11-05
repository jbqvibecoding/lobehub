import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationModel } from '@/database/models/notification';
import { notificationDeliveries } from '@/database/schemas/notification';
import { users } from '@/database/schemas/user';

import type { PushDeliveryResult } from '../../push/types';
import { notifyPendingApprovals } from '../index';

vi.mock('@/database/server', () => ({ serverDB: {} }));

const db = await getTestDB();
const userId = 'approval-notification-user';

const pendingTools = [
  { apiName: 'send_email', id: 'call-1', identifier: 'gmail-mcp' },
  { apiName: 'createPaymentLink', id: 'call-2', identifier: 'stripe-mcp' },
];

const pushReturning = (result: PushDeliveryResult) => ({ deliver: vi.fn(async () => result) });

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('notifyPendingApprovals', () => {
  it('adds a row per pending call and pushes the pause once, without arguments', async () => {
    const push = pushReturning({ providerMessageId: '[]', status: 'sent' });

    await notifyPendingApprovals(
      db,
      { agentId: 'agent-1', pendingTools, topicId: 'topic-1', userId },
      push,
    );

    const rows = await new NotificationModel(db, userId).list();
    expect(rows.map((r) => [r.dedupeKey, r.content, r.actionUrl]).sort()).toEqual([
      ['tool-approval:call-1', 'Send email · gmail-mcp', '/agent/agent-1/topic-1'],
      ['tool-approval:call-2', 'Create payment link · stripe-mcp', '/agent/agent-1/topic-1'],
    ]);

    expect(push.deliver).toHaveBeenCalledTimes(1);
    expect(push.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Send email · gmail-mcp, and 1 more',
        title: 'Waiting for you',
        translations: { zh: { content: 'Send email · gmail-mcp 等 2 项操作', title: '等你处理' } },
        userId,
      }),
    );

    const deliveries = await db.select().from(notificationDeliveries);
    expect(deliveries).toEqual([
      expect.objectContaining({ channel: 'push', providerMessageId: '[]', status: 'sent' }),
    ]);
  });

  it('does not notify again when the same pause is retried or resumed', async () => {
    const push = pushReturning({ providerMessageId: '[]', status: 'sent' });

    await notifyPendingApprovals(db, { pendingTools, userId }, push);
    await notifyPendingApprovals(db, { pendingTools: [pendingTools[1]], userId }, push);

    expect(push.deliver).toHaveBeenCalledTimes(1);
    expect(await new NotificationModel(db, userId).getUnreadCount()).toBe(2);
  });

  it('keeps the inbox rows but records nothing when the user has no phone', async () => {
    const push = pushReturning({ failedReason: 'no_tokens', status: 'failed' });

    await notifyPendingApprovals(db, { pendingTools: [pendingTools[0]], userId }, push);

    expect(await new NotificationModel(db, userId).getUnreadCount()).toBe(1);
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });

  it('records a failed push so it can be told apart from a delivered one', async () => {
    const push = pushReturning({ failedReason: 'rate_limited', status: 'failed' });

    await notifyPendingApprovals(db, { pendingTools: [pendingTools[0]], userId }, push);

    const [row] = await new NotificationModel(db, userId).list();
    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, row.id));
    expect(deliveries).toEqual([
      expect.objectContaining({ failedReason: 'rate_limited', sentAt: null, status: 'failed' }),
    ]);
  });
});
