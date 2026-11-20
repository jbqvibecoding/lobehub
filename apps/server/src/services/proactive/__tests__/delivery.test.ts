import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationModel } from '@/database/models/notification';
import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { notificationDeliveries } from '@/database/schemas/notification';
import { users } from '@/database/schemas/user';

import type { PushDeliveryContext, PushDeliveryResult } from '../../push/types';
import { deliverRoutineResult, PROACTIVE_PUSH_CATEGORY } from '../delivery';

vi.mock('@/database/server', () => ({ serverDB: {} }));

const db = await getTestDB();
const userId = 'proactive-delivery-user';

const pushReturning = (result: PushDeliveryResult) => ({
  deliver: vi.fn(async (_ctx: PushDeliveryContext) => result),
});

const routineTask = {
  assigneeAgentId: 'agent-biber',
  context: { starterRoutine: 'morning-brief' },
  id: 'task-1',
  identifier: 'T-1',
  name: '晨报',
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('deliverRoutineResult', () => {
  it('pushes the result with a Not now button and enters it in the ledger', async () => {
    const push = pushReturning({ providerMessageId: '[]', status: 'sent' });

    const outcome = await deliverRoutineResult(
      db,
      userId,
      { brief: { id: 'brief-1', title: '今天三件事，最急的是十点的面试' }, task: routineTask },
      push,
    );

    expect(outcome).toMatchObject({
      briefId: 'brief-1',
      kind: 'routine',
      routineId: 'morning-brief',
      state: 'sent',
      taskId: 'task-1',
    });
    expect(push.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: PROACTIVE_PUSH_CATEGORY,
        content: '今天三件事，最急的是十点的面试',
        data: { kind: 'routine', outcomeId: outcome!.id, taskId: 'task-1' },
        title: '晨报',
        userId,
      }),
    );

    const [notification] = await new NotificationModel(db, userId).list();
    expect(notification).toMatchObject({
      actionUrl: '/task/T-1',
      dedupeKey: 'routine:brief-1',
      type: 'routine_result',
    });
    expect(outcome!.notificationId).toBe(notification.id);
    expect(await db.select().from(notificationDeliveries)).toEqual([
      expect.objectContaining({ channel: 'push', status: 'sent' }),
    ]);
  });

  it('delivers each brief once, even when asked twice', async () => {
    const push = pushReturning({ providerMessageId: '[]', status: 'sent' });
    const result = { brief: { id: 'brief-1', title: 'Today' }, task: routineTask };

    await deliverRoutineResult(db, userId, result, push);
    expect(await deliverRoutineResult(db, userId, result, push)).toBeUndefined();

    expect(push.deliver).toHaveBeenCalledTimes(1);
    expect(await new ProactiveMessageModel(db, userId).recent()).toHaveLength(1);
  });

  it('ignores tasks that are not starter routines', async () => {
    const push = pushReturning({ status: 'sent' });

    const outcome = await deliverRoutineResult(
      db,
      userId,
      { brief: { id: 'brief-2', title: 'Done' }, task: { ...routineTask, context: {} } },
      push,
    );

    expect(outcome).toBeUndefined();
    expect(push.deliver).not.toHaveBeenCalled();
  });

  it('still keeps the ledger entry when no phone is registered', async () => {
    const push = pushReturning({ failedReason: 'no_tokens', status: 'failed' });

    const outcome = await deliverRoutineResult(
      db,
      userId,
      { brief: { id: 'brief-3', title: 'Today' }, task: routineTask },
      push,
    );

    expect(outcome?.state).toBe('sent');
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });
});
