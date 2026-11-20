import { index, integer, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

/** How much Biber speaks up unprompted: never, only reminders, or reminders and follow-ups. */
export type ProactiveLevel = 'off' | 'quiet' | 'standard';

/**
 * Proactive settings - one row per user, created on first use; a user without one has the
 * defaults. Besides what the user chose, it keeps the day's budget and the last send and attempt,
 * which space messages out and keep two checks from running for one user at once.
 */
export const proactiveSettings = pgTable('proactive_settings', {
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey()
    .notNull(),

  level: text('level').$type<ProactiveLevel>().notNull().default('standard'),
  /** Quiet hours, as hours of the day in the user's time zone; equal values mean none */
  quietStart: integer('quiet_start').notNull().default(22),
  quietEnd: integer('quiet_end').notNull().default(8),
  /** IANA time zone the phone reported, e.g. `Asia/Shanghai` */
  timeZone: text('time_zone'),
  /** "Quiet for 7 days": no unprompted messages until then */
  cooldownUntil: timestamptz('cooldown_until'),

  /** The user's local date `spentToday` counts for, as `YYYY-MM-DD` */
  budgetDate: text('budget_date'),
  spentToday: integer('spent_today').notNull().default(0),
  lastSentAt: timestamptz('last_sent_at'),
  lastAttemptAt: timestamptz('last_attempt_at'),

  /** The "From Biber" chat unprompted messages are written into */
  topicId: text('topic_id'),

  updatedAt: updatedAt(),
});

export type ProactiveSettingsItem = typeof proactiveSettings.$inferSelect;

export type ProactiveThoughtKind = 'follow_up' | 'reminder';

/** `immediate` loses its point when late (a reminder for tomorrow); `window` keeps for a while */
export type ProactiveThoughtUrgency = 'immediate' | 'window';

export type ProactiveThoughtStatus = 'done' | 'dropped' | 'expired' | 'open';

/**
 * Proactive thoughts - the pending-to-say list: things Biber means to bring up when the moment is
 * right, such as a reminder before something on the user's calendar or a follow-up after it. Each
 * is said at most once: one per user and `sourceRef`, whatever its status, so a thought that was
 * said, dropped or expired is never derived again.
 */
export const proactiveThoughts = pgTable(
  'proactive_thoughts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id'),

    kind: text('kind').$type<ProactiveThoughtKind>().notNull(),
    /** What to bring up, in one line for the model; at most 200 characters */
    seed: text('seed').notNull(),
    /** Where it came from, e.g. `activity` */
    source: text('source').notNull(),
    /** What it came from, as a dedupe key, e.g. `activity:<id>:reminder` */
    sourceRef: text('source_ref').notNull(),
    /** When the thing it is about happens or ended, for wording like "tomorrow at 10" */
    occursAt: timestamptz('occurs_at'),

    urgency: text('urgency').$type<ProactiveThoughtUrgency>().notNull().default('window'),
    /** 0 to 1: among thoughts of the same urgency, higher goes first */
    weight: real('weight').notNull().default(0.5),
    expiresAt: timestamptz('expires_at'),

    status: text('status').$type<ProactiveThoughtStatus>().notNull().default('open'),
    surfacedAt: timestamptz('surfaced_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('proactive_thoughts_user_source_ref_unique').on(t.userId, t.sourceRef),
    index('proactive_thoughts_status_idx').on(t.status),
  ],
);

export type NewProactiveThought = typeof proactiveThoughts.$inferInsert;
export type ProactiveThoughtItem = typeof proactiveThoughts.$inferSelect;

/**
 * What Biber reached out about unprompted: a routine's result, a reminder before something on the
 * user's calendar, or a follow-up after it.
 */
export type ProactiveMessageKind = 'follow_up' | 'reminder' | 'routine';

/**
 * What became of a message the user did not ask for. It only moves forward, in this order:
 * `sent`, `ignored` (no reaction within a day), `opened`, `dismissed` ("not now"), `replied`.
 * A later, stronger signal replaces a weaker one; nothing moves a message back.
 */
export type ProactiveMessageState = 'dismissed' | 'ignored' | 'opened' | 'replied' | 'sent';

/**
 * Proactive messages - the results ledger: one row per message Biber sent without being asked,
 * and how the user responded. It is what limits how often Biber speaks up, and what the open and
 * ignore rates are computed from. Ids of the task, brief, topic and message carry no foreign key:
 * the ledger outlives them, and only goes with the user's account.
 */
export const proactiveMessages = pgTable(
  'proactive_messages',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id'),

    kind: text('kind').$type<ProactiveMessageKind>().notNull(),
    /** For routine results: which starter routine, e.g. `morning-brief` */
    routineId: text('routine_id'),
    /** The pending-to-say item this message was about, if any */
    thoughtId: uuid('thought_id'),
    taskId: text('task_id'),
    briefId: text('brief_id'),
    topicId: text('topic_id'),
    messageId: text('message_id'),
    /** The inbox row the push was sent for */
    notificationId: text('notification_id'),
    /** What the push said, for the stats and for not repeating it */
    title: text('title'),

    state: text('state').$type<ProactiveMessageState>().notNull().default('sent'),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
    openedAt: timestamptz('opened_at'),
    dismissedAt: timestamptz('dismissed_at'),
    repliedAt: timestamptz('replied_at'),
  },
  (t) => [
    index('proactive_messages_user_sent_idx').on(t.userId, t.sentAt),
    index('proactive_messages_state_sent_idx').on(t.state, t.sentAt),
  ],
);

export type NewProactiveMessage = typeof proactiveMessages.$inferInsert;
export type ProactiveMessageItem = typeof proactiveMessages.$inferSelect;
