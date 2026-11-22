import type { UserProfileEntry } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  activeEntries,
  confirmEntries,
  dropEntry,
  PROFILE_SECTION_LIMIT,
  PROFILE_TEXT_LIMIT,
  saveEntry,
} from '../entries';

const t1 = new Date('2026-11-01T08:00:00.000Z');
const t2 = new Date('2026-11-22T08:00:00.000Z');

/** Applies saves in order, failing loudly on a refusal. */
const saved = (...inputs: Parameters<typeof saveEntry>[1][]) =>
  inputs.reduce<UserProfileEntry[]>((entries, input) => {
    const outcome = saveEntry(entries, input, t1);
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.entries;
  }, []);

describe('profile entries', () => {
  it('numbers each list section on its own: G0, G1, PE0', () => {
    const entries = saved(
      { section: 'goals', text: 'Run a marathon' },
      { section: 'goals', text: 'Ship the app' },
      { section: 'people', text: 'Lin, my wife' },
    );

    expect(entries.map((entry) => entry.id)).toEqual(['G0', 'G1', 'PE0']);
    expect(entries[0]).toEqual({
      id: 'G0',
      section: 'goals',
      status: 'active',
      text: 'Run a marathon',
      updatedAt: t1.toISOString(),
    });
  });

  it('keeps the id when an entry changes, and never gives a deleted id again', () => {
    const entries = saved(
      { section: 'goals', text: 'Run a marathon before October' },
      { section: 'goals', text: 'Ship the app' },
    );

    const changed = saveEntry(entries, { id: 'G0', section: 'goals', text: 'Before November' }, t2);
    expect(changed).toMatchObject({ entry: { id: 'G0', text: 'Before November' }, ok: true });

    const dropped = dropEntry(changed.ok ? changed.entries : [], 'G1', t2);
    expect(dropped).toMatchObject({
      entry: { id: 'G1', section: 'goals', status: 'dropped', text: '' },
      ok: true,
    });

    const next = saveEntry(
      dropped.ok ? dropped.entries : [],
      { section: 'goals', text: 'Read' },
      t2,
    );
    expect(next.ok && next.entry.id).toBe('G2');
    expect(activeEntries(next.ok ? next.entries : []).map((entry) => entry.id)).toEqual([
      'G0',
      'G2',
    ]);
  });

  it('only replaces a one-entry section with its id, so nothing is overwritten by accident', () => {
    const entries = saved({ section: 'now', text: 'Busy with the move' });
    expect(entries[0].id).toBe('now');

    expect(saveEntry(entries, { section: 'now', text: 'Settled in' }, t2)).toEqual({
      message:
        '"now" already says: "Busy with the move". Ask the user before changing it, then call saveEntry again with id "now".',
      ok: false,
      reason: 'exists',
    });
    expect(saveEntry(entries, { id: 'now', section: 'now', text: 'Settled in' }, t2)).toMatchObject(
      { entries: [{ id: 'now', text: 'Settled in' }], ok: true },
    );

    const gone = dropEntry(entries, 'now', t2);
    expect(
      saveEntry(gone.ok ? gone.entries : [], { section: 'now', text: 'New job' }, t2),
    ).toMatchObject({ entries: [{ id: 'now', status: 'active', text: 'New job' }], ok: true });
  });

  it('refuses what does not fit: unknown sections and ids, empty or long text, a full section', () => {
    const entries = saved({ section: 'goals', text: 'Run' });

    expect(saveEntry(entries, { section: 'hobbies', text: 'x' }, t2)).toMatchObject({
      reason: 'section',
    });
    expect(saveEntry(entries, { section: 'goals', text: '   ' }, t2)).toMatchObject({
      reason: 'empty',
    });
    expect(
      saveEntry(entries, { section: 'goals', text: '长'.repeat(PROFILE_TEXT_LIMIT + 1) }, t2),
    ).toMatchObject({ reason: 'too_long' });
    expect(
      saveEntry(entries, { section: 'goals', text: '长'.repeat(PROFILE_TEXT_LIMIT) }, t2).ok,
    ).toBe(true);
    expect(saveEntry(entries, { id: 'G9', section: 'goals', text: 'x' }, t2)).toMatchObject({
      reason: 'not_found',
    });
    expect(saveEntry(entries, { id: 'G0', section: 'projects', text: 'x' }, t2)).toMatchObject({
      reason: 'wrong_section',
    });
    expect(dropEntry(entries, 'PE0', t2)).toMatchObject({ reason: 'not_found' });

    const full = saved(
      ...Array.from({ length: PROFILE_SECTION_LIMIT }, (_, i) => ({
        section: 'people',
        text: `Friend ${i}`,
      })),
    );
    expect(saveEntry(full, { section: 'people', text: 'One more' }, t2)).toMatchObject({
      reason: 'limit',
    });
  });

  it('confirms entries that still hold without changing them, and reports unknown ids', () => {
    const entries = saved({ section: 'goals', text: 'Run' }, { section: 'projects', text: 'App' });

    const result = confirmEntries(entries, ['G0', 'G7'], t2);

    expect(result.confirmed).toEqual(['G0']);
    expect(result.unknown).toEqual(['G7']);
    expect(result.entries[0]).toMatchObject({
      reviewedAt: t2.toISOString(),
      text: 'Run',
      updatedAt: t1.toISOString(),
    });
    expect(result.entries[1].reviewedAt).toBeUndefined();
  });
});
