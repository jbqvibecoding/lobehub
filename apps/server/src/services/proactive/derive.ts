import type { ProactiveThoughtDraft } from '@/database/models/proactiveThought';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Remind of something this far ahead at most. */
export const REMIND_AHEAD_MS = 3 * DAY;
/** Ask how something went for this long after it ended. */
export const FOLLOW_UP_WITHIN_MS = 2 * DAY;

/** Activity statuses that mean there is nothing left to remind of or ask about. */
const CLOSED_STATUSES = new Set(['canceled', 'cancelled']);

const SEED_LIMIT = 200;

/** An activity remembered from the user's conversations, with when it starts and ends. */
export interface RememberedActivity {
  endsAt: Date | null;
  id: string;
  startsAt: Date | null;
  status: string;
  /** The memory's title or the activity's own description */
  summary: string;
}

const seedOf = (activity: RememberedActivity) => activity.summary.trim().slice(0, SEED_LIMIT);

/**
 * What to bring up about the activities in the user's memory: a reminder before one starts in the
 * next three days, and a follow-up on one that ended in the last two. Plain date rules on what
 * memory already recorded; nothing is guessed from wording.
 */
export const deriveThoughts = (
  activities: RememberedActivity[],
  now: Date,
  agentId?: string,
): ProactiveThoughtDraft[] => {
  const drafts: ProactiveThoughtDraft[] = [];

  for (const activity of activities) {
    if (CLOSED_STATUSES.has(activity.status.toLowerCase()) || !seedOf(activity)) continue;

    const startsIn = activity.startsAt ? activity.startsAt.getTime() - now.getTime() : null;
    if (startsIn !== null && startsIn > 0 && startsIn <= REMIND_AHEAD_MS) {
      drafts.push({
        agentId,
        expiresAt: activity.startsAt,
        kind: 'reminder',
        occursAt: activity.startsAt,
        seed: seedOf(activity),
        source: 'activity',
        sourceRef: `activity:${activity.id}:reminder`,
        urgency: startsIn <= DAY ? 'immediate' : 'window',
        weight: 0.85,
      });
      continue;
    }

    const ended = activity.endsAt ?? activity.startsAt;
    const endedAgo = ended ? now.getTime() - ended.getTime() : null;
    if (ended && endedAgo !== null && endedAgo >= 0 && endedAgo <= FOLLOW_UP_WITHIN_MS) {
      drafts.push({
        agentId,
        expiresAt: new Date(ended.getTime() + FOLLOW_UP_WITHIN_MS),
        kind: 'follow_up',
        occursAt: ended,
        seed: seedOf(activity),
        source: 'activity',
        sourceRef: `activity:${activity.id}:follow_up`,
        urgency: 'window',
        weight: 0.6,
      });
    }
  }

  return drafts;
};
