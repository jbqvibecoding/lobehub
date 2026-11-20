import { describe, expect, it } from 'vitest';

import { deriveThoughts, type RememberedActivity } from '../derive';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-11-20T06:00:00Z');
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * HOUR);

const activity = (overrides: Partial<RememberedActivity>): RememberedActivity => ({
  endsAt: null,
  id: 'act-1',
  startsAt: null,
  status: 'pending',
  summary: 'Job interview at Acme',
  ...overrides,
});

describe('deriveThoughts', () => {
  it('reminds of what starts in the next three days, most pressing within a day', () => {
    const [soon, later] = deriveThoughts(
      [
        activity({ id: 'tomorrow', startsAt: at(20) }),
        activity({ id: 'thursday', startsAt: at(60) }),
        activity({ id: 'next-week', startsAt: at(24 * 6) }),
      ],
      now,
      'agent-biber',
    );

    expect(soon).toMatchObject({
      agentId: 'agent-biber',
      expiresAt: at(20),
      kind: 'reminder',
      occursAt: at(20),
      seed: 'Job interview at Acme',
      sourceRef: 'activity:tomorrow:reminder',
      urgency: 'immediate',
    });
    expect(later).toMatchObject({ sourceRef: 'activity:thursday:reminder', urgency: 'window' });
  });

  it('asks how something went within two days of its end, until then', () => {
    const drafts = deriveThoughts(
      [
        activity({ endsAt: at(-3), id: 'this-morning', startsAt: at(-5) }),
        activity({ id: 'no-end', startsAt: at(-30) }),
        activity({ endsAt: at(-72), id: 'long-ago', startsAt: at(-74) }),
      ],
      now,
    );

    expect(drafts).toEqual([
      expect.objectContaining({
        expiresAt: at(-3 + 48),
        kind: 'follow_up',
        sourceRef: 'activity:this-morning:follow_up',
      }),
      expect.objectContaining({ sourceRef: 'activity:no-end:follow_up' }),
    ]);
  });

  it('skips cancelled activities, ones without a date, and ones with nothing to say', () => {
    expect(
      deriveThoughts(
        [
          activity({ startsAt: at(10), status: 'Cancelled' }),
          activity({ id: 'undated' }),
          activity({ id: 'blank', startsAt: at(10), summary: '   ' }),
        ],
        now,
      ),
    ).toEqual([]);
  });

  it('keeps the seed to 200 characters', () => {
    const [draft] = deriveThoughts([activity({ startsAt: at(5), summary: 'x'.repeat(300) })], now);

    expect(draft.seed).toHaveLength(200);
  });
});
