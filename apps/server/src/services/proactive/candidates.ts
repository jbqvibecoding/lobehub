import type {
  ProactiveLevel,
  ProactiveMessageItem,
  ProactiveThoughtItem,
  ProactiveThoughtKind,
} from '@/database/schemas';

import { PROACTIVE_LEVELS } from './timing';

/** At most this many thoughts go to the model to pick from. */
export const MAX_CANDIDATES = 3;

/** A kind needs this many settled messages before dismissals can rule it out. */
const BAN_MIN_SETTLED = 4;

/**
 * Kinds the user keeps waving away: at least four settled messages of the kind, more than half of
 * them dismissed with "Not now". Pass the last 30 days of the ledger.
 */
export const bannedKinds = (ledger: Pick<ProactiveMessageItem, 'kind' | 'state'>[]) => {
  const tally = new Map<string, { dismissed: number; settled: number }>();
  for (const { kind, state } of ledger) {
    if (state === 'sent') continue;
    const counts = tally.get(kind) ?? { dismissed: 0, settled: 0 };
    counts.settled += 1;
    if (state === 'dismissed') counts.dismissed += 1;
    tally.set(kind, counts);
  }

  return new Set(
    [...tally]
      .filter(([, { dismissed, settled }]) => settled >= BAN_MIN_SETTLED && dismissed * 2 > settled)
      .map(([kind]) => kind as ProactiveThoughtKind),
  );
};

/**
 * How many unprompted messages in a row, newest first, the user ignored. Routine results, which
 * the user asked for, and messages still within their day do not count either way.
 */
export const ignoredStreak = (recent: Pick<ProactiveMessageItem, 'kind' | 'state'>[]) => {
  let streak = 0;
  for (const { kind, state } of recent) {
    if (kind === 'routine' || state === 'sent') continue;
    if (state !== 'ignored') break;
    streak += 1;
  }
  return streak;
};

/**
 * The open thoughts worth offering the model now: not expired, of a kind the level allows and the
 * user has not ruled out, most urgent first, then by weight.
 */
export const selectCandidates = (
  thoughts: ProactiveThoughtItem[],
  { banned, level, now }: { banned: Set<ProactiveThoughtKind>; level: ProactiveLevel; now: Date },
) => {
  const allowed = new Set(PROACTIVE_LEVELS[level].kinds);

  return thoughts
    .filter(
      (thought) =>
        thought.status === 'open' &&
        (!thought.expiresAt || thought.expiresAt > now) &&
        allowed.has(thought.kind) &&
        !banned.has(thought.kind),
    )
    .sort(
      (a, b) =>
        Number(b.urgency === 'immediate') - Number(a.urgency === 'immediate') ||
        b.weight - a.weight,
    )
    .slice(0, MAX_CANDIDATES);
};
