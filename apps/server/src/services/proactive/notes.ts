import { randomUUID } from 'node:crypto';

import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import debug from 'debug';

import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { NoteLimitError, ProactiveThoughtModel } from '@/database/models/proactiveThought';
import type { ProactiveThoughtItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ASKED_GRACE_MS } from './asked';
import { resolveTimeZone, validTimeZone } from './biber';
import { PROACTIVE_LEVELS } from './timing';

const log = debug('lobe-server:proactive:notes');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** A note's time may be a little in the past (the model took a while), not more */
const PAST_SLACK_MS = 5 * MINUTE;
const FURTHEST_MS = 366 * DAY;
const ABOUT_LIMIT = 200;
/** ISO 8601 with a UTC offset or Z, so the time means one moment whatever the server's zone */
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * What the user can have Biber bring up later: a reminder they `asked` for at a time of their
 * own, or, on Biber's own initiative, a `reminder` before something or a `follow_up` after it.
 */
export type ReminderKind = 'asked' | 'follow_up' | 'reminder';

export interface AddReminderInput {
  about: string;
  /** When to bring it up, ISO 8601 with a UTC offset */
  at: string;
  /** When the thing itself happens, if known */
  eventAt?: string;
  kind: ReminderKind;
}

export interface ReminderScope {
  agentId?: string;
  db: LobeChatDatabase;
  now?: Date;
  /** The zone of the device the user is on (the browser), when the caller knows it */
  timeZone?: string;
  userId: string;
}

const failure = (type: string, message: string): BuiltinServerRuntimeOutput => ({
  content: message,
  error: { message, type },
  success: false,
});

/** "Sat, 21 Nov 2026, 15:00", in the user's zone: what the model reads and repeats to the user. */
export const describeMoment = (when: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: 'short',
    timeZone,
    weekday: 'short',
    year: 'numeric',
  }).format(when);

const zoneFor = async ({ db, timeZone, userId }: ReminderScope) =>
  validTimeZone(timeZone) ?? (await resolveTimeZone(db, userId));

const parseMoment = (value: string | undefined, field: string, timeZone: string) => {
  if (!value || !WITH_OFFSET.test(value.trim())) {
    return `"${field}" must be an ISO 8601 date and time with a UTC offset, e.g. 2026-11-25T15:00:00+08:00. The user's time zone is ${timeZone}.`;
  }
  const moment = new Date(value.trim());
  return Number.isNaN(moment.getTime()) ? `"${field}" is not a valid date and time.` : moment;
};

const kindOf = (thought: ProactiveThoughtItem): ReminderKind =>
  thought.source === 'asked' ? 'asked' : thought.kind;

/**
 * Notes something to bring up later. Asked-for reminders go out at `at`; Biber's own notes become
 * eligible at `at` and are said when the moment is right, within the limits on unprompted
 * messages. The reply tells the model when it will happen, or that it will not, so it does not
 * promise the user something that will not come.
 */
export const addReminder = async (
  scope: ReminderScope,
  input: AddReminderInput,
): Promise<BuiltinServerRuntimeOutput> => {
  const now = scope.now ?? new Date();
  const timeZone = await zoneFor(scope);

  const about = input.about?.trim() ?? '';
  if (!about) return failure('InvalidReminder', '"about" must say what to bring up.');
  if (about.length > ABOUT_LIMIT) {
    return failure('InvalidReminder', `"about" must be at most ${ABOUT_LIMIT} characters.`);
  }
  if (!['asked', 'follow_up', 'reminder'].includes(input.kind)) {
    return failure('InvalidReminder', '"kind" must be asked, reminder or follow_up.');
  }

  const at = parseMoment(input.at, 'at', timeZone);
  if (typeof at === 'string') return failure('InvalidReminderTime', at);
  const nowText = `It is now ${describeMoment(now, timeZone)} (${timeZone}).`;
  if (at.getTime() < now.getTime() - PAST_SLACK_MS) {
    return failure('InvalidReminderTime', `"at" is in the past. ${nowText}`);
  }
  if (at.getTime() > now.getTime() + FURTHEST_MS) {
    return failure('InvalidReminderTime', '"at" must be within a year from now.');
  }

  let eventAt: Date | undefined;
  if (input.eventAt) {
    const parsed = parseMoment(input.eventAt, 'eventAt', timeZone);
    if (typeof parsed === 'string') return failure('InvalidReminderTime', parsed);
    eventAt = parsed;
  }
  if (input.kind === 'reminder' && eventAt && eventAt < at) {
    return failure(
      'InvalidReminderTime',
      'A reminder must come before the thing: "at" is after "eventAt".',
    );
  }
  if (input.kind === 'follow_up' && eventAt && eventAt > at) {
    return failure(
      'InvalidReminderTime',
      'A follow-up comes after the thing: "at" is before "eventAt".',
    );
  }

  const asked = input.kind === 'asked';
  const expiresAt = asked
    ? new Date(at.getTime() + ASKED_GRACE_MS)
    : input.kind === 'reminder'
      ? (eventAt ?? new Date(at.getTime() + DAY))
      : new Date(at.getTime() + 2 * DAY);

  let note: ProactiveThoughtItem;
  try {
    note = await new ProactiveThoughtModel(scope.db, scope.userId).addNote({
      agentId: scope.agentId,
      dueAt: at,
      expiresAt,
      kind: input.kind === 'follow_up' ? 'follow_up' : 'reminder',
      occursAt: asked ? at : (eventAt ?? null),
      seed: about,
      source: asked ? 'asked' : 'agent',
      sourceRef: `agent:${randomUUID()}`,
      urgency: input.kind === 'follow_up' ? 'window' : 'immediate',
      weight: input.kind === 'follow_up' ? 0.7 : 0.9,
    });
  } catch (error) {
    if (error instanceof NoteLimitError) {
      return failure('ReminderLimit', `${error.message}. Cancel some with cancelReminder first.`);
    }
    throw error;
  }
  log('userId=%s noted %s %s due %s', scope.userId, input.kind, note.id, at.toISOString());

  const when = `${describeMoment(at, timeZone)} (${timeZone})`;
  const state = { reminder: { about, at: at.toISOString(), id: note.id, kind: input.kind } };
  if (asked) {
    return {
      content: `Noted (id ${note.id}). "${about}" will be sent at ${when}.`,
      state,
      success: true,
    };
  }

  const preferences = await new ProactiveSettingsModel(scope.db, scope.userId).preferences();
  const caveats: string[] = [];
  if (preferences.level === 'off') {
    caveats.push(
      'The user has turned off messages from you, so this will not be brought up unless they turn them back on. Do not promise to bring it up.',
    );
  } else if (!PROACTIVE_LEVELS[preferences.level].kinds.includes(note.kind)) {
    caveats.push(
      'The user only wants reminders from you, so this follow-up will not be brought up. Do not promise to bring it up.',
    );
  } else if (preferences.cooldownUntil && preferences.cooldownUntil > at) {
    caveats.push(
      `The user asked not to hear from you until ${describeMoment(preferences.cooldownUntil, timeZone)}, so this may not be brought up.`,
    );
  }

  return {
    content: [
      `Noted (id ${note.id}). You may bring up "${about}" from ${when}, when the moment is right: not in the user's quiet hours, and not if they heard from you a lot that day.`,
      ...caveats,
    ].join(' '),
    state,
    success: true,
  };
};

/** What Biber means to bring up, with the current time, so the model can work out new times. */
export const listReminders = async (scope: ReminderScope): Promise<BuiltinServerRuntimeOutput> => {
  const now = scope.now ?? new Date();
  const timeZone = await zoneFor(scope);
  const open = await new ProactiveThoughtModel(scope.db, scope.userId).listOpen();
  const at = (thought: ProactiveThoughtItem) => thought.dueAt ?? thought.occursAt;
  const sorted = [...open].sort(
    (a, b) => (at(a)?.getTime() ?? Infinity) - (at(b)?.getTime() ?? Infinity),
  );

  const label: Record<ReminderKind, string> = {
    asked: 'reminder the user asked for',
    follow_up: 'follow-up',
    reminder: 'reminder',
  };
  const lines = sorted.map((thought) => {
    const moment = at(thought);
    const origin = thought.source === 'activity' ? ', from memory' : '';
    return `- id ${thought.id}: ${label[kindOf(thought)]}${origin}, ${moment ? describeMoment(moment, timeZone) : 'no set time'}: ${thought.seed}`;
  });

  return {
    content: [
      `It is now ${describeMoment(now, timeZone)} in the user's time zone (${timeZone}).`,
      lines.length > 0 ? 'Waiting to be brought up:' : 'Nothing is waiting to be brought up.',
      ...lines,
    ].join('\n'),
    state: {
      reminders: sorted.map((thought) => ({
        about: thought.seed,
        at: at(thought)?.toISOString() ?? null,
        id: thought.id,
        kind: kindOf(thought),
      })),
      timeZone,
    },
    success: true,
  };
};

export const cancelReminder = async (
  scope: ReminderScope,
  { id }: { id: string },
): Promise<BuiltinServerRuntimeOutput> => {
  const valid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id ?? '');
  const dropped = valid && (await new ProactiveThoughtModel(scope.db, scope.userId).drop(id));
  if (!dropped) {
    return failure(
      'ReminderNotFound',
      `Nothing open with id ${id}. Call listReminders to see the ids.`,
    );
  }
  return {
    content: 'Cancelled: it will not be brought up.',
    state: { cancelled: id },
    success: true,
  };
};
