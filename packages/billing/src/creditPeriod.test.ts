import { describe, expect, it } from 'vitest';

import { creditPeriodAt } from './creditPeriod';

const period = (anchor: string, now: string) => {
  const { end, start } = creditPeriodAt(new Date(anchor), new Date(now));
  return [start.toISOString(), end.toISOString()];
};

describe('creditPeriodAt', () => {
  it('gives monthly windows from the anchor, also within a yearly subscription', () => {
    expect(period('2026-03-15T08:30:00Z', '2026-03-15T08:30:00Z')).toEqual([
      '2026-03-15T08:30:00.000Z',
      '2026-04-15T08:30:00.000Z',
    ]);
    expect(period('2026-03-15T08:30:00Z', '2026-11-10T12:00:00Z')).toEqual([
      '2026-10-15T08:30:00.000Z',
      '2026-11-15T08:30:00.000Z',
    ]);
    expect(period('2026-03-15T08:30:00Z', '2027-01-15T08:29:59Z')).toEqual([
      '2026-12-15T08:30:00.000Z',
      '2027-01-15T08:30:00.000Z',
    ]);
  });

  it('uses the last day of a shorter month without drifting afterwards', () => {
    expect(period('2026-01-31T00:00:00Z', '2026-02-27T23:59:59Z')).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-02-28T00:00:00.000Z',
    ]);
    expect(period('2026-01-31T00:00:00Z', '2026-02-28T00:00:00Z')).toEqual([
      '2026-02-28T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
    ]);
    expect(period('2028-01-31T00:00:00Z', '2028-02-29T10:00:00Z')).toEqual([
      '2028-02-29T00:00:00.000Z',
      '2028-03-31T00:00:00.000Z',
    ]);
  });

  it('leaves no gap and no overlap between consecutive windows', () => {
    const anchor = new Date('2026-01-31T17:45:00Z');
    let cursor = anchor;

    for (let month = 0; month < 30; month += 1) {
      const window = creditPeriodAt(anchor, cursor);
      expect(window.start.getTime()).toBe(cursor.getTime());
      expect(creditPeriodAt(anchor, new Date(window.end.getTime() - 1))).toEqual(window);
      cursor = window.end;
    }
  });
});
