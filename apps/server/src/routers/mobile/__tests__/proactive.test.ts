// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { briefs } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationModel } from '@/database/models/notification';
import { ProactiveMessageModel } from '@/database/models/proactiveMessage';

import { cleanupTestUser, createTestUser } from '../../lambda/__tests__/integration/setup';
import { proactiveRouter } from '../proactive';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const callerFor = (userId: string) =>
  proactiveRouter.createCaller({ jwtPayload: { userId }, userId } as any);

/** A morning brief delivered to the user: its brief, inbox row and ledger entry. */
const deliveredBrief = async (userId: string) => {
  const [brief] = await testDB
    .insert(briefs)
    .values({ summary: 's', title: 'Today', type: 'result', userId })
    .returning();
  const notification = await new NotificationModel(testDB, userId).create({
    category: 'agent',
    content: 'Today',
    dedupeKey: `routine:${brief.id}`,
    title: 'Morning brief',
    type: 'routine_result',
  });
  const message = await new ProactiveMessageModel(testDB, userId).record({
    briefId: brief.id,
    kind: 'routine',
    notificationId: notification!.id,
    routineId: 'morning-brief',
  });
  return { brief, message, notification: notification! };
};

beforeEach(async () => {
  testDB = await getTestDB();
});

describe('mobile proactiveRouter', () => {
  it('counts a tap as opened and marks the inbox row and the brief read', async () => {
    const userId = await createTestUser(testDB);
    const { brief, message, notification } = await deliveredBrief(userId);

    expect(await callerFor(userId).opened({ id: message.id })).toEqual({ state: 'opened' });

    const [row] = await new NotificationModel(testDB, userId).list();
    expect(row).toMatchObject({ id: notification.id, isRead: true });
    const [stored] = await testDB.select().from(briefs).where(eq(briefs.id, brief.id));
    expect(stored.readAt).toBeInstanceOf(Date);

    await cleanupTestUser(testDB, userId);
  });

  it('counts Not now as dismissed, and a later tap does not undo it', async () => {
    const userId = await createTestUser(testDB);
    const { message } = await deliveredBrief(userId);
    const caller = callerFor(userId);

    expect(await caller.dismiss({ id: message.id })).toEqual({ state: 'dismissed' });
    expect(await caller.opened({ id: message.id })).toEqual({ state: 'dismissed' });

    await cleanupTestUser(testDB, userId);
  });

  it('refuses to report on another user’s message', async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    const { message } = await deliveredBrief(otherId);

    await expect(callerFor(userId).opened({ id: message.id })).rejects.toThrow('No such message');
    expect((await new ProactiveMessageModel(testDB, otherId).findById(message.id))?.state).toBe(
      'sent',
    );

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });
});
