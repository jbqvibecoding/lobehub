import type { ProactiveLevel, ProactiveThoughtKind } from '@/database/schemas';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** What each level lets Biber bring up, and how many unprompted messages a day at most. */
export const PROACTIVE_LEVELS: Record<
  ProactiveLevel,
  { dailyCap: number; kinds: ProactiveThoughtKind[] }
> = {
  off: { dailyCap: 0, kinds: [] },
  quiet: { dailyCap: 1, kinds: ['reminder'] },
  standard: { dailyCap: 3, kinds: ['reminder', 'follow_up', 'profile_check'] },
};

/** Two unprompted messages are at least this far apart. */
export const MIN_GAP_MS = 2 * HOUR;
/** A check for a user that sent nothing waits this long before the next one. */
export const RETRY_GAP_MS = 30 * MINUTE;
/** Biber does not interrupt a user who wrote to it this recently. */
export const USER_ACTIVE_MS = 10 * MINUTE;
/** After this many ignored messages in a row, at most one a day until the user reacts again. */
export const IGNORED_STREAK_LIMIT = 3;

export type TimingVerdict =
  'cooling_down' | 'no_budget' | 'off' | 'ok' | 'quiet_hours' | 'too_soon' | 'user_active';

export interface TimingInput {
  cooldownUntil: Date | null;
  /** Consecutive ignored messages, newest first, until the user last reacted */
  ignoredStreak: number;
  lastSentAt: Date | null;
  lastUserMessageAt: Date | null;
  level: ProactiveLevel;
  now: Date;
  quietEnd: number;
  quietStart: number;
  /** Messages already sent on the user's current local day */
  spentToday: number;
  timeZone: string;
}

/** The hour (0-23) and the date (`YYYY-MM-DD`) at `now` in `timeZone`. */
export const localTime = (now: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );

  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};

/** Whether `hour` falls in quiet hours from `start` to `end`, which may cross midnight. */
export const isQuietHour = (hour: number, start: number, end: number) => {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};

/** Today's cap: the level's, or one a day while the user keeps ignoring messages. */
export const dailyCapFor = (level: ProactiveLevel, ignoredStreak: number) => {
  const { dailyCap } = PROACTIVE_LEVELS[level];
  return ignoredStreak >= IGNORED_STREAK_LIMIT ? Math.min(dailyCap, 1) : dailyCap;
};

/**
 * Whether now is a moment Biber may speak up unprompted, checked in Muse's order: off, quiet
 * hours, "quiet for a while", too soon after the last message, the user writing right now, and
 * the day's budget. The first reason that applies is returned.
 */
export const decideTiming = (input: TimingInput): TimingVerdict => {
  const { now } = input;

  if (input.level === 'off') return 'off';

  const { hour } = localTime(now, input.timeZone);
  if (isQuietHour(hour, input.quietStart, input.quietEnd)) return 'quiet_hours';

  if (input.cooldownUntil && input.cooldownUntil > now) return 'cooling_down';

  if (input.lastSentAt && now.getTime() - input.lastSentAt.getTime() < MIN_GAP_MS) {
    return 'too_soon';
  }

  if (
    input.lastUserMessageAt &&
    now.getTime() - input.lastUserMessageAt.getTime() < USER_ACTIVE_MS
  ) {
    return 'user_active';
  }

  if (input.spentToday >= dailyCapFor(input.level, input.ignoredStreak)) return 'no_budget';

  return 'ok';
};
