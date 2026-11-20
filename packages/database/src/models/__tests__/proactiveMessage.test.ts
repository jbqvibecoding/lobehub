import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProactiveMessageModel, summarizeProactiveStats } from '../../models/proactiveMessage';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'proactive-user';
const otherUserId = 'proactive-other-user';
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ProactiveMessageModel', () => {
  it('only moves a message to a stronger signal', async () => {
    const model = new ProactiveMessageModel(serverDB, userId);
    const message = await model.record({ kind: 'reminder' });
    expect(message.state).toBe('sent');

    expect((await model.markOpened(message.id))?.state).toBe('opened');
    expect((await model.markReplied(message.id))?.state).toBe('replied');
    // A late "not now" or a second open says less than the reply, so nothing changes
    expect(await model.markDismissed(message.id)).toBeUndefined();
    expect(await model.markOpened(message.id)).toBeUndefined();

    const stored = await model.findById(message.id);
    expect(stored?.state).toBe('replied');
    expect(stored?.openedAt).toBeInstanceOf(Date);
    expect(stored?.repliedAt).toBeInstanceOf(Date);
  });

  it('turns a message nobody reacted to within a day into ignored, which an open still beats', async () => {
    const model = new ProactiveMessageModel(serverDB, userId);
    const stale = await model.record({ kind: 'routine', sentAt: new Date(Date.now() - 25 * HOUR) });
    const fresh = await model.record({ kind: 'routine' });
    const answered = await model.record({
      kind: 'routine',
      sentAt: new Date(Date.now() - 30 * HOUR),
    });
    await model.markOpened(answered.id);

    expect(await model.ignoreOverdue()).toEqual([{ id: stale.id }]);
    expect((await model.findById(fresh.id))?.state).toBe('sent');
    expect((await model.findById(answered.id))?.state).toBe('opened');

    expect((await model.markOpened(stale.id))?.state).toBe('opened');
  });

  it('never touches another user’s messages', async () => {
    const theirs = await new ProactiveMessageModel(serverDB, otherUserId).record({
      kind: 'reminder',
      sentAt: new Date(Date.now() - 48 * HOUR),
    });
    const mine = new ProactiveMessageModel(serverDB, userId);

    expect(await mine.markOpened(theirs.id)).toBeUndefined();
    expect(await mine.findById(theirs.id)).toBeUndefined();
    expect(await mine.ignoreOverdue()).toEqual([]);
  });

  it('counts each kind and routine by how it ended', async () => {
    const model = new ProactiveMessageModel(serverDB, userId);
    const brief = { kind: 'routine' as const, routineId: 'morning-brief' };
    const opened = await model.record(brief);
    await model.markOpened(opened.id);
    await model.record({ ...brief, sentAt: new Date(Date.now() - 30 * HOUR) });
    await model.record({ ...brief, sentAt: new Date(Date.now() - 30 * HOUR) });
    await model.record(brief);
    await model.record({ kind: 'reminder', sentAt: new Date(Date.now() - 10 * 24 * HOUR) });
    await ProactiveMessageModel.ignoreOverdue(serverDB);

    const stats = summarizeProactiveStats(
      await ProactiveMessageModel.countByState(serverDB, new Date(Date.now() - 7 * 24 * HOUR)),
    );

    expect(stats).toEqual([
      {
        awaiting: 1,
        dismissRate: 0,
        ignoreRate: 2 / 3,
        kind: 'routine',
        openRate: 1 / 3,
        replyRate: 0,
        routineId: 'morning-brief',
        sent: 4,
      },
    ]);
  });
});

describe('summarizeProactiveStats', () => {
  it('counts a dismissal or a reply as opened, and leaves out messages still within their day', () => {
    const [row] = summarizeProactiveStats([
      { count: 2, kind: 'reminder', routineId: null, state: 'replied' },
      { count: 1, kind: 'reminder', routineId: null, state: 'dismissed' },
      { count: 1, kind: 'reminder', routineId: null, state: 'ignored' },
      { count: 5, kind: 'reminder', routineId: null, state: 'sent' },
    ]);

    expect(row).toMatchObject({
      awaiting: 5,
      dismissRate: 1 / 4,
      ignoreRate: 1 / 4,
      openRate: 3 / 4,
      replyRate: 2 / 4,
      sent: 9,
    });
  });
});
