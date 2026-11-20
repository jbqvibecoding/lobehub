import type { ProactiveThoughtItem } from '@lobechat/database/schemas';
import { describe, expect, it } from 'vitest';

import { bannedKinds, ignoredStreak, selectCandidates } from '../candidates';

const now = new Date('2026-11-20T06:00:00Z');

const thought = (overrides: Partial<ProactiveThoughtItem>): ProactiveThoughtItem => ({
  agentId: null,
  createdAt: now,
  expiresAt: null,
  id: 'thought',
  kind: 'reminder',
  occursAt: null,
  seed: 'seed',
  source: 'activity',
  sourceRef: 'ref',
  status: 'open',
  surfacedAt: null,
  urgency: 'window',
  userId: 'user',
  weight: 0.5,
  ...overrides,
});

describe('selectCandidates', () => {
  const thoughts = [
    thought({ id: 'follow-up', kind: 'follow_up', weight: 0.6 }),
    thought({ id: 'reminder-light', weight: 0.4 }),
    thought({ id: 'reminder-heavy', weight: 0.9 }),
    thought({ id: 'reminder-now', urgency: 'immediate', weight: 0.2 }),
    thought({ expiresAt: new Date(now.getTime() - 1), id: 'expired', weight: 1 }),
    thought({ id: 'done', status: 'done', weight: 1 }),
  ];

  it('puts urgent thoughts first, then by weight, and offers three at most', () => {
    expect(
      selectCandidates(thoughts, { banned: new Set(), level: 'standard', now }).map(
        (item) => item.id,
      ),
    ).toEqual(['reminder-now', 'reminder-heavy', 'follow-up']);
  });

  it('keeps to the kinds the level allows and the user has not ruled out', () => {
    expect(
      selectCandidates(thoughts, { banned: new Set(), level: 'quiet', now }).map((item) => item.id),
    ).toEqual(['reminder-now', 'reminder-heavy', 'reminder-light']);
    expect(
      selectCandidates(thoughts, { banned: new Set(['reminder']), level: 'standard', now }).map(
        (item) => item.id,
      ),
    ).toEqual(['follow-up']);
    expect(selectCandidates(thoughts, { banned: new Set(), level: 'off', now })).toEqual([]);
  });
});

describe('bannedKinds', () => {
  it('rules out a kind dismissed in more than half of at least four settled messages', () => {
    const ledger = [
      ...Array.from({ length: 3 }, () => ({
        kind: 'follow_up' as const,
        state: 'dismissed' as const,
      })),
      { kind: 'follow_up' as const, state: 'opened' as const },
      { kind: 'follow_up' as const, state: 'sent' as const },
      { kind: 'reminder' as const, state: 'dismissed' as const },
      { kind: 'reminder' as const, state: 'dismissed' as const },
      { kind: 'reminder' as const, state: 'replied' as const },
    ];

    expect(bannedKinds(ledger)).toEqual(new Set(['follow_up']));
  });
});

describe('ignoredStreak', () => {
  it('counts ignored messages in a row, skipping routines and messages still within their day', () => {
    expect(
      ignoredStreak([
        { kind: 'reminder', state: 'sent' },
        { kind: 'reminder', state: 'ignored' },
        { kind: 'routine', state: 'opened' },
        { kind: 'follow_up', state: 'ignored' },
        { kind: 'reminder', state: 'opened' },
        { kind: 'reminder', state: 'ignored' },
      ]),
    ).toBe(2);
  });
});
