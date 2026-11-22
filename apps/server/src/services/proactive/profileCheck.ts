import type { UserProfileEntry, UserProfileSection } from '@lobechat/types';

import type { ProactiveThoughtDraft } from '@/database/models/proactiveThought';

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long an entry of each section stays fresh before Biber asks whether it still holds, after
 * LifeOS's freshness rules: where things stand changes fast, a mission or the people in one's life
 * slowly. What the user is called is never asked about.
 */
export const PROFILE_FRESH_DAYS: Partial<Record<UserProfileSection, number>> = {
  challenges: 60,
  goals: 30,
  ideal: 90,
  mission: 90,
  now: 14,
  people: 180,
  projects: 30,
  style: 180,
};

/** At most one profile check in this long. */
export const PROFILE_CHECK_GAP_MS = 7 * DAY;

/** When the entry was last known to hold: changed, or confirmed as it is. */
export const entryAsOf = (entry: Pick<UserProfileEntry, 'reviewedAt' | 'updatedAt'>) =>
  [entry.updatedAt, entry.reviewedAt].filter(Boolean).sort().at(-1)!;

/** One check per entry as it stands: asked once, it is not asked again until it changes. */
export const profileCheckRef = (entry: UserProfileEntry) =>
  `profile_check:${entry.id}:${entryAsOf(entry)}`;

/**
 * The one profile entry most out of date, as a thought to bring up: a question whether it still
 * holds. Deleted entries, the name, and entries already asked about as they stand are left out.
 */
export const deriveProfileCheck = (
  entries: UserProfileEntry[],
  { agentId, asked, now }: { agentId?: string; asked: Set<string>; now: Date },
): ProactiveThoughtDraft | undefined => {
  const [stalest] = entries
    .flatMap((entry) => {
      const freshDays = PROFILE_FRESH_DAYS[entry.section];
      if (entry.status !== 'active' || !freshDays || asked.has(profileCheckRef(entry))) return [];
      const overdue = (now.getTime() - new Date(entryAsOf(entry)).getTime()) / (freshDays * DAY);
      return overdue >= 1 ? [{ entry, overdue }] : [];
    })
    .sort((a, b) => b.overdue - a.overdue);
  if (!stalest) return undefined;

  const { entry } = stalest;
  return {
    agentId,
    expiresAt: new Date(now.getTime() + PROFILE_CHECK_GAP_MS),
    kind: 'profile_check',
    occursAt: new Date(entryAsOf(entry)),
    seed: `[${entry.id}] (${entry.section}) ${entry.text}`.slice(0, 200),
    source: 'profile',
    sourceRef: profileCheckRef(entry),
    urgency: 'window',
    weight: 0.3,
  };
};
