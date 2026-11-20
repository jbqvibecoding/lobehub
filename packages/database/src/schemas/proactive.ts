import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { users } from './user';

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
