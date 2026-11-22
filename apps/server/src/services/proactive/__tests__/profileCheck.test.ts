import type { UserProfileEntry } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deriveProfileCheck, profileCheckRef } from '../profileCheck';

const now = new Date('2026-11-22T08:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const entry = (
  id: string,
  section: UserProfileEntry['section'],
  ageDays: number,
  extra: Partial<UserProfileEntry> = {},
): UserProfileEntry => ({
  id,
  section,
  status: 'active',
  text: `${id} text`,
  updatedAt: daysAgo(ageDays),
  ...extra,
});

const derive = (entries: UserProfileEntry[], asked: string[] = []) =>
  deriveProfileCheck(entries, { agentId: 'biber', asked: new Set(asked), now });

describe('deriveProfileCheck', () => {
  it('asks about nothing while every entry is fresh for its section', () => {
    expect(
      derive([
        entry('now', 'now', 13),
        entry('G0', 'goals', 29),
        entry('C0', 'challenges', 59),
        entry('M0', 'mission', 89),
        entry('PE0', 'people', 179),
        entry('name', 'name', 900),
      ]),
    ).toBeUndefined();
  });

  it('picks the one entry most out of date for its section', () => {
    const draft = derive([
      entry('G0', 'goals', 45), // 1.5 times its 30 days
      entry('now', 'now', 28), // 2 times its 14 days
      entry('PE0', 'people', 200), // 1.1 times its 180 days
    ]);

    expect(draft).toMatchObject({
      agentId: 'biber',
      expiresAt: new Date('2026-11-29T08:00:00.000Z'),
      kind: 'profile_check',
      seed: '[now] (now) now text',
      source: 'profile',
      sourceRef: `profile_check:now:${daysAgo(28)}`,
      urgency: 'window',
    });
  });

  it('counts from when the user last said it still holds', () => {
    const confirmed = entry('G0', 'goals', 60, { reviewedAt: daysAgo(3) });

    expect(derive([confirmed])).toBeUndefined();
  });

  it('never asks about a deleted entry, nor twice about one as it stands', () => {
    const stale = entry('G0', 'goals', 60);
    const dropped = entry('G1', 'goals', 90, { status: 'dropped', text: '' });

    expect(derive([dropped])).toBeUndefined();
    expect(derive([stale, entry('PR0', 'projects', 40)], [profileCheckRef(stale)])).toMatchObject({
      seed: '[PR0] (projects) PR0 text',
    });
  });
});
