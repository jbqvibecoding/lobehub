import { describe, expect, it } from 'vitest';

import { decideTiming, isQuietHour, localTime, type TimingInput } from '../timing';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** 2026-11-20 06:00 UTC: 14:00 in Shanghai, 01:00 in New York */
const now = new Date('2026-11-20T06:00:00Z');

const input = (overrides: Partial<TimingInput> = {}): TimingInput => ({
  cooldownUntil: null,
  ignoredStreak: 0,
  lastSentAt: null,
  lastUserMessageAt: null,
  level: 'standard',
  now,
  quietEnd: 8,
  quietStart: 22,
  spentToday: 0,
  timeZone: 'Asia/Shanghai',
  ...overrides,
});

describe('localTime', () => {
  it('reads the hour and date in the user’s time zone', () => {
    expect(localTime(now, 'Asia/Shanghai')).toEqual({ date: '2026-11-20', hour: 14 });
    expect(localTime(now, 'America/New_York')).toEqual({ date: '2026-11-20', hour: 1 });
    expect(localTime(new Date('2026-11-20T23:30:00Z'), 'Asia/Shanghai')).toEqual({
      date: '2026-11-21',
      hour: 7,
    });
  });
});

describe('isQuietHour', () => {
  it('handles windows across midnight, within a day, and none at all', () => {
    expect([21, 22, 23, 0, 7, 8].map((hour) => isQuietHour(hour, 22, 8))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect([12, 13, 14].map((hour) => isQuietHour(hour, 13, 14))).toEqual([false, true, false]);
    expect(isQuietHour(3, 9, 9)).toBe(false);
  });
});

describe('decideTiming', () => {
  it('lets Biber speak in the afternoon with nothing in the way', () => {
    expect(decideTiming(input())).toBe('ok');
  });

  it('says nothing when the user turned it off', () => {
    expect(decideTiming(input({ level: 'off' }))).toBe('off');
  });

  it('keeps quiet hours in the user’s own time zone', () => {
    expect(decideTiming(input({ timeZone: 'America/New_York' }))).toBe('quiet_hours');
    expect(decideTiming(input({ quietEnd: 15, quietStart: 13 }))).toBe('quiet_hours');
  });

  it('waits out "quiet for a while"', () => {
    expect(decideTiming(input({ cooldownUntil: new Date(now.getTime() + HOUR) }))).toBe(
      'cooling_down',
    );
    expect(decideTiming(input({ cooldownUntil: new Date(now.getTime() - HOUR) }))).toBe('ok');
  });

  it('spaces messages two hours apart', () => {
    expect(decideTiming(input({ lastSentAt: new Date(now.getTime() - 90 * MINUTE) }))).toBe(
      'too_soon',
    );
    expect(decideTiming(input({ lastSentAt: new Date(now.getTime() - 3 * HOUR) }))).toBe('ok');
  });

  it('does not interrupt a user who is writing', () => {
    expect(decideTiming(input({ lastUserMessageAt: new Date(now.getTime() - 5 * MINUTE) }))).toBe(
      'user_active',
    );
  });

  it('keeps to the day’s budget, which drops to one after three ignored messages', () => {
    expect(decideTiming(input({ spentToday: 2 }))).toBe('ok');
    expect(decideTiming(input({ spentToday: 3 }))).toBe('no_budget');
    expect(decideTiming(input({ level: 'quiet', spentToday: 1 }))).toBe('no_budget');
    expect(decideTiming(input({ ignoredStreak: 3, spentToday: 1 }))).toBe('no_budget');
    expect(decideTiming(input({ ignoredStreak: 2, spentToday: 1 }))).toBe('ok');
  });
});
