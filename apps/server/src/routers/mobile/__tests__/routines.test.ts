// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { tasks } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../../lambda/__tests__/integration/setup';
import { routinesRouter } from '../routines';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const callerFor = (userId: string) =>
  routinesRouter.createCaller({ jwtPayload: { userId }, userId } as any);

beforeEach(async () => {
  testDB = await getTestDB();
});

describe('mobile routinesRouter', () => {
  it('offers the starter routines in the phone language, all off at first', async () => {
    const userId = await createTestUser(testDB);

    const routines = await callerFor(userId).list({ locale: 'zh-CN' });

    expect(routines.map((routine) => [routine.id, routine.name, routine.enabled])).toEqual([
      ['morning-brief', '晨报', false],
      ['evening-wrap', '下班小结', false],
      ['weekly-review', '每周回顾', false],
    ]);
    await cleanupTestUser(testDB, userId);
  });

  it('turns the morning brief on as a scheduled task for Biber, in the user time zone', async () => {
    const userId = await createTestUser(testDB);
    const caller = callerFor(userId);

    const { taskId } = await caller.enable({
      id: 'morning-brief',
      locale: 'en-US',
      timeZone: 'Asia/Shanghai',
    });

    const [task] = await testDB.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task).toMatchObject({
      automationMode: 'schedule',
      context: expect.objectContaining({ starterRoutine: 'morning-brief' }),
      name: 'Morning brief',
      schedulePattern: '30 7 * * *',
      scheduleTimezone: 'Asia/Shanghai',
      status: 'scheduled',
    });
    expect(task.assigneeAgentId).toBeTruthy();
    expect((await caller.list())[0]).toMatchObject({ enabled: true, taskId });
    await cleanupTestUser(testDB, userId);
  });

  it('turns a routine off and on again without making a second task', async () => {
    const userId = await createTestUser(testDB);
    const caller = callerFor(userId);
    const { taskId } = await caller.enable({ id: 'weekly-review', timeZone: 'Not/AZone' });

    await caller.disable({ id: 'weekly-review' });
    let [task] = await testDB.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task).toMatchObject({ automationMode: null, status: 'backlog' });

    expect((await caller.enable({ id: 'weekly-review' })).taskId).toBe(taskId);
    [task] = await testDB.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task).toMatchObject({
      automationMode: 'schedule',
      scheduleTimezone: 'UTC',
      status: 'scheduled',
    });
    expect(await testDB.select().from(tasks).where(eq(tasks.createdByUserId, userId))).toHaveLength(
      1,
    );
    await cleanupTestUser(testDB, userId);
  });

  it('refuses a routine it does not know', async () => {
    const userId = await createTestUser(testDB);

    await expect(callerFor(userId).enable({ id: 'mine-bitcoin' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await cleanupTestUser(testDB, userId);
  });
});
