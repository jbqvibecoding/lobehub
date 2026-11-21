// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { NOTE_LIMIT } from '@/database/models/proactiveThought';
import { proactiveThoughts } from '@/database/schemas';
import { users } from '@/database/schemas/user';

import { ASKED_GRACE_MS } from '../asked';
import { addReminder, cancelReminder, listReminders } from '../notes';

vi.mock('@/database/server', () => ({ serverDB: {} }));

const db = await getTestDB();
const userId = 'proactive-notes-user';
const otherUserId = 'proactive-notes-other';
/** Saturday 21 November 2026, 07:00 UTC: 15:00 in Shanghai */
const now = new Date('2026-11-21T07:00:00Z');
const scope = { db, now, timeZone: 'Asia/Shanghai', userId };

const rows = () => db.select().from(proactiveThoughts);

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('addReminder', () => {
  it('notes a reminder the user asked for, sent at its time, and says when in their zone', async () => {
    const result = await addReminder(scope, {
      about: 'Call mom',
      at: '2026-11-21T18:00:00+08:00',
      kind: 'asked',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      '"Call mom" will be sent at Sat, 21 Nov 2026, 18:00 (Asia/Shanghai)',
    );
    const [row] = await rows();
    expect(row).toMatchObject({
      dueAt: new Date('2026-11-21T10:00:00Z'),
      expiresAt: new Date(new Date('2026-11-21T10:00:00Z').getTime() + ASKED_GRACE_MS),
      kind: 'reminder',
      seed: 'Call mom',
      source: 'asked',
      status: 'open',
    });
    expect(result.content).toContain(row.id);
  });

  it('keeps Biber’s own notes until their moment has passed', async () => {
    await addReminder(scope, {
      about: 'The dentist',
      at: '2026-11-23T08:00:00+08:00',
      eventAt: '2026-11-23T10:00:00+08:00',
      kind: 'reminder',
    });
    await addReminder(scope, {
      about: 'Flight to Tokyo',
      at: '2026-11-24T08:00:00+08:00',
      kind: 'reminder',
    });
    const followUp = await addReminder(scope, {
      about: 'The job interview at Acme',
      at: '2026-11-25T18:00:00+08:00',
      eventAt: '2026-11-25T15:00:00+08:00',
      kind: 'follow_up',
    });

    expect(followUp.content).toContain(
      'You may bring up "The job interview at Acme" from Wed, 25 Nov 2026, 18:00',
    );
    const byAbout = Object.fromEntries((await rows()).map((row) => [row.seed, row]));
    // A reminder is worthless once the thing starts; without its time, a day after the note's
    expect(byAbout['The dentist']).toMatchObject({
      expiresAt: new Date('2026-11-23T02:00:00Z'),
      occursAt: new Date('2026-11-23T02:00:00Z'),
      source: 'agent',
    });
    expect(byAbout['Flight to Tokyo'].expiresAt).toEqual(new Date('2026-11-25T00:00:00Z'));
    // A follow-up keeps two days
    expect(byAbout['The job interview at Acme']).toMatchObject({
      expiresAt: new Date('2026-11-27T10:00:00Z'),
      kind: 'follow_up',
    });
  });

  it('tells the model when its own note will not be said, so it does not promise it', async () => {
    const settings = new ProactiveSettingsModel(db, userId);
    const note = { about: 'How the trip went', at: '2026-11-22T20:00:00+08:00' } as const;

    await settings.update({ level: 'quiet' });
    expect((await addReminder(scope, { ...note, kind: 'follow_up' })).content).toContain(
      'only wants reminders from you, so this follow-up will not be brought up',
    );

    await settings.update({ level: 'off' });
    const off = await addReminder(scope, { ...note, kind: 'reminder' });
    expect(off.content).toContain('turned off messages from you');
    // What the user asked for still goes out
    const asked = await addReminder(scope, { ...note, kind: 'asked' });
    expect(asked.content).not.toContain('turned off');
  });

  it('turns away times the server cannot place, in the past, or too far ahead', async () => {
    const asked = (at: string) => addReminder(scope, { about: 'Call mom', at, kind: 'asked' });

    const noOffset = await asked('2026-11-21T18:00:00');
    expect(noOffset).toMatchObject({ error: { type: 'InvalidReminderTime' }, success: false });
    expect(noOffset.content).toContain("The user's time zone is Asia/Shanghai");

    const past = await asked('2026-11-21T14:00:00+08:00');
    expect(past.content).toContain('It is now Sat, 21 Nov 2026, 15:00 (Asia/Shanghai)');
    // A few minutes late is fine: the model took a moment
    expect((await asked('2026-11-21T14:57:00+08:00')).success).toBe(true);

    expect((await asked('2028-01-01T09:00:00+08:00')).success).toBe(false);
    expect((await asked('next tuesday')).success).toBe(false);
    expect(
      (
        await addReminder(scope, {
          about: 'Dentist',
          at: '2026-11-23T11:00:00+08:00',
          eventAt: '2026-11-23T10:00:00+08:00',
          kind: 'reminder',
        })
      ).success,
    ).toBe(false);
    expect(
      (await addReminder(scope, { about: ' ', at: '2026-11-22T09:00:00+08:00', kind: 'asked' }))
        .success,
    ).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('stops at the limit on open notes', async () => {
    await db.insert(proactiveThoughts).values(
      Array.from({ length: NOTE_LIMIT }, (_, i) => ({
        kind: 'reminder' as const,
        seed: `note ${i}`,
        source: 'agent' as const,
        sourceRef: `agent:${i}`,
        userId,
      })),
    );

    const result = await addReminder(scope, {
      about: 'One more',
      at: '2026-11-22T09:00:00+08:00',
      kind: 'asked',
    });
    expect(result).toMatchObject({ error: { type: 'ReminderLimit' }, success: false });
  });

  it('uses the user’s own zone when the caller does not know it', async () => {
    await new ProactiveSettingsModel(db, userId).update({ timeZone: 'America/New_York' });

    const result = await addReminder(
      { db, now, userId },
      { about: 'Call mom', at: '2026-11-21T17:00:00-05:00', kind: 'asked' },
    );
    expect(result.content).toContain('Sat, 21 Nov 2026, 17:00 (America/New_York)');
  });
});

describe('listReminders and cancelReminder', () => {
  it('lists the user’s own, soonest first, with the time now, and cancels by id', async () => {
    await addReminder(scope, { about: 'Call mom', at: '2026-11-22T09:00:00+08:00', kind: 'asked' });
    await addReminder(scope, {
      about: 'Pay rent',
      at: '2026-11-21T20:00:00+08:00',
      kind: 'reminder',
    });
    await addReminder(
      { ...scope, userId: otherUserId },
      { about: 'Someone else’s', at: '2026-11-21T19:00:00+08:00', kind: 'asked' },
    );

    const listed = await listReminders(scope);
    expect(listed.content).toContain("It is now Sat, 21 Nov 2026, 15:00 in the user's time zone");
    expect(listed.content).not.toContain('Someone else');
    const lines = listed.content.split('\n').filter((line) => line.startsWith('- '));
    expect(lines[0]).toContain('reminder, Sat, 21 Nov 2026, 20:00: Pay rent');
    expect(lines[1]).toContain('reminder the user asked for, Sun, 22 Nov 2026, 09:00: Call mom');

    const mom = listed.state.reminders.find((item: { about: string }) => item.about === 'Call mom');
    expect(await cancelReminder({ db, userId: otherUserId }, { id: mom.id })).toMatchObject({
      success: false,
    });
    expect(await cancelReminder({ db, userId }, { id: mom.id })).toMatchObject({ success: true });
    expect(await cancelReminder({ db, userId }, { id: 'not-an-id' })).toMatchObject({
      error: { type: 'ReminderNotFound' },
    });
    expect((await listReminders(scope)).content).not.toContain('Call mom');
  });

  it('says plainly when nothing is waiting', async () => {
    expect((await listReminders(scope)).content).toContain('Nothing is waiting to be brought up.');
  });
});
