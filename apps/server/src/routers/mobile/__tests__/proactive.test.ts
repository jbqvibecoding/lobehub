// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { briefs } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationModel } from '@/database/models/notification';
import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { ProactiveThoughtModel } from '@/database/models/proactiveThought';

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

  it('changes the user’s settings, pauses for a while and resumes, and refuses unknown zones', async () => {
    const userId = await createTestUser(testDB);
    const caller = callerFor(userId);

    expect(await caller.getSettings()).toMatchObject({ level: 'standard', quietStart: 22 });

    const paused = await caller.updateSettings({
      level: 'quiet',
      quietForDays: 7,
      timeZone: 'Asia/Shanghai',
    });
    expect(paused).toMatchObject({ level: 'quiet', timeZone: 'Asia/Shanghai' });
    expect(paused.cooldownUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    expect((await caller.updateSettings({ quietForDays: null })).cooldownUntil).toBeNull();
    await expect(caller.updateSettings({ timeZone: 'Mars/Olympus' })).rejects.toThrow();

    await cleanupTestUser(testDB, userId);
  });

  it('lists what Biber means to say, soonest first, and drops only the user’s own', async () => {
    const userId = await createTestUser(testDB);
    const otherId = await createTestUser(testDB);
    const [later, sooner] = await new ProactiveThoughtModel(testDB, userId).addNew([
      {
        kind: 'follow_up',
        occursAt: new Date(Date.now() + 9e7),
        seed: 'Flight',
        source: 'activity',
        sourceRef: 'a',
      },
      {
        kind: 'reminder',
        occursAt: new Date(Date.now() + 1e7),
        seed: 'Dentist',
        source: 'activity',
        sourceRef: 'b',
      },
    ]);
    const caller = callerFor(userId);

    expect((await caller.listThoughts()).map((thought) => thought.seed)).toEqual([
      'Dentist',
      'Flight',
    ]);
    expect(await callerFor(otherId).dropThought({ id: sooner.id })).toEqual({ dropped: false });
    expect(await caller.dropThought({ id: sooner.id })).toEqual({ dropped: true });
    expect((await caller.listThoughts()).map((thought) => thought.id)).toEqual([later.id]);

    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherId);
  });

  it('lists notes from chats by when they are due, and leaves out asked ones already going out', async () => {
    const userId = await createTestUser(testDB);
    await new ProactiveThoughtModel(testDB, userId).addNew([
      {
        dueAt: new Date(Date.now() + 5e6),
        kind: 'reminder',
        occursAt: new Date(Date.now() + 9e7),
        seed: 'Pay rent',
        source: 'agent',
        sourceRef: 'agent:rent',
      },
      {
        dueAt: new Date(Date.now() + 1e6),
        kind: 'reminder',
        seed: 'Call mom',
        source: 'asked',
        sourceRef: 'agent:mom',
      },
      {
        dueAt: new Date(Date.now() - 1e3),
        kind: 'reminder',
        seed: 'Water the plants',
        source: 'asked',
        sourceRef: 'agent:plants',
      },
    ]);

    const listed = await callerFor(userId).listThoughts();
    expect(listed.map(({ seed, source }) => ({ seed, source }))).toEqual([
      { seed: 'Call mom', source: 'asked' },
      { seed: 'Pay rent', source: 'agent' },
    ]);

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
