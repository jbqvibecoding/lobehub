import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProactiveSettingsModel } from '../../models/proactiveSettings';
import { NOTE_LIMIT, NoteLimitError, ProactiveThoughtModel } from '../../models/proactiveThought';
import { proactiveThoughts } from '../../schemas/proactive';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'thought-user';
const otherUserId = 'thought-other-user';
const HOUR = 60 * 60 * 1000;

const draft = (sourceRef: string, overrides = {}) => ({
  kind: 'reminder' as const,
  seed: 'Dentist appointment',
  source: 'activity' as const,
  sourceRef,
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ProactiveThoughtModel', () => {
  it('adds a thought once per source, even after it was said', async () => {
    const model = new ProactiveThoughtModel(serverDB, userId);

    const [added] = await model.addNew([draft('activity:a:reminder')]);
    expect(await model.addNew([draft('activity:a:reminder')])).toEqual([]);

    await model.markDone(added.id);
    expect(await model.addNew([draft('activity:a:reminder')])).toEqual([]);
    expect(await model.listOpen()).toEqual([]);

    // The same source for another user is theirs to have
    expect(
      await new ProactiveThoughtModel(serverDB, otherUserId).addNew([draft('activity:a:reminder')]),
    ).toHaveLength(1);
  });

  it('expires thoughts whose moment has passed, and lets the user drop their own only', async () => {
    const model = new ProactiveThoughtModel(serverDB, userId);
    const [late, current, endless] = await model.addNew([
      draft('a', { expiresAt: new Date(Date.now() - HOUR) }),
      draft('b', { expiresAt: new Date(Date.now() + HOUR) }),
      draft('c'),
    ]);

    expect(await model.expireOverdue()).toEqual([{ id: late.id }]);
    expect((await model.listOpen()).map((thought) => thought.id).sort()).toEqual(
      [current.id, endless.id].sort(),
    );

    expect(await new ProactiveThoughtModel(serverDB, otherUserId).drop(current.id)).toBe(false);
    expect(await model.drop(current.id)).toBe(true);
    expect(await model.drop(current.id)).toBe(false);
    expect((await model.listOpen()).map((thought) => thought.id)).toEqual([endless.id]);
  });

  it('keeps at most NOTE_LIMIT open notes from chats per user, not counting memory', async () => {
    const model = new ProactiveThoughtModel(serverDB, userId);
    const notes = Array.from({ length: NOTE_LIMIT }, (_, i) =>
      draft(`agent:${i}`, { source: i % 2 ? 'agent' : 'asked' }),
    );
    await serverDB.insert(proactiveThoughts).values(notes.map((note) => ({ ...note, userId })));
    await model.addNew([draft('activity:x:reminder')]);

    await expect(model.addNote(draft('agent:one-more', { source: 'agent' }))).rejects.toThrow(
      NoteLimitError,
    );
    // Another user's list is their own
    await expect(
      new ProactiveThoughtModel(serverDB, otherUserId).addNote(
        draft('agent:a', { source: 'agent' }),
      ),
    ).resolves.toMatchObject({ status: 'open', userId: otherUserId });

    const note = (await model.listOpen()).find((thought) => thought.source !== 'activity')!;
    await model.drop(note.id);
    await expect(
      model.addNote(draft('agent:fits-again', { source: 'agent' })),
    ).resolves.toMatchObject({ status: 'open' });
  });

  it('takes due asked reminders across users once, reopens a failed one, expires late ones', async () => {
    const now = new Date();
    const asked = (sourceRef: string, dueInHours: number, expiresInHours = dueInHours + 6) =>
      draft(sourceRef, {
        dueAt: new Date(now.getTime() + dueInHours * HOUR),
        expiresAt: new Date(now.getTime() + expiresInHours * HOUR),
        source: 'asked' as const,
      });
    const mine = new ProactiveThoughtModel(serverDB, userId);
    const [due, later, stale] = await mine.addNew([
      asked('agent:due', -1),
      asked('agent:later', 2),
      asked('agent:stale', -8, -2),
    ]);
    const [othersDue] = await new ProactiveThoughtModel(serverDB, otherUserId).addNew([
      asked('agent:other', -0.5),
    ]);
    await mine.addNew([
      draft('agent:own', { dueAt: new Date(now.getTime() - HOUR), source: 'agent' }),
    ]);

    const taken = await ProactiveThoughtModel.takeDueAsked(serverDB, now, 10);
    expect(taken.map((thought) => thought.id).sort()).toEqual([due.id, othersDue.id].sort());
    expect(taken.every((thought) => thought.status === 'done')).toBe(true);
    expect(await ProactiveThoughtModel.takeDueAsked(serverDB, now, 10)).toEqual([]);

    await mine.reopen(due.id);
    expect((await ProactiveThoughtModel.takeDueAsked(serverDB, now, 10)).map((t) => t.id)).toEqual([
      due.id,
    ]);

    expect(await ProactiveThoughtModel.expireOverdueAsked(serverDB, now)).toEqual([
      { id: stale.id },
    ]);
    expect(await mine.findOpen(later.id)).toMatchObject({ id: later.id });
  });
});

describe('ProactiveSettingsModel', () => {
  it('remembers the From Biber chat without counting a send', async () => {
    const model = new ProactiveSettingsModel(serverDB, userId);
    await model.setTopic('topic-1');

    expect(await model.find()).toMatchObject({
      lastSentAt: null,
      spentToday: 0,
      topicId: 'topic-1',
    });
  });

  it('gives the defaults until the user changes something', async () => {
    const model = new ProactiveSettingsModel(serverDB, userId);
    expect(await model.preferences()).toMatchObject({
      level: 'standard',
      quietEnd: 8,
      quietStart: 22,
    });

    await model.update({ level: 'quiet', timeZone: 'Asia/Shanghai' });
    await model.update({ quietStart: 23 });

    expect(await model.preferences()).toMatchObject({
      level: 'quiet',
      quietStart: 23,
      timeZone: 'Asia/Shanghai',
    });
  });

  it('lets one check at a time take the user, then waits out the retry gap', async () => {
    const model = new ProactiveSettingsModel(serverDB, userId);
    const now = new Date();

    expect(await model.claim(now, 30 * 60 * 1000)).toBeDefined();
    expect(await model.claim(new Date(now.getTime() + 60_000), 30 * 60 * 1000)).toBeUndefined();
    expect(await model.claim(new Date(now.getTime() + 31 * 60_000), 30 * 60 * 1000)).toBeDefined();
  });

  it('counts sends per local day and starts over on a new one', async () => {
    const model = new ProactiveSettingsModel(serverDB, userId);
    const now = new Date();
    await model.claim(now, 0);

    await model.recordSend({ budgetDate: '2026-11-20', now, topicId: 'topic-1' });
    const second = await model.recordSend({ budgetDate: '2026-11-20', now });
    expect(second).toMatchObject({ spentToday: 2, topicId: 'topic-1' });

    const nextDay = await model.recordSend({ budgetDate: '2026-11-21', now });
    expect(nextDay).toMatchObject({ budgetDate: '2026-11-21', spentToday: 1 });
  });
});
