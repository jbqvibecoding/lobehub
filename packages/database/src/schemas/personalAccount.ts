import { jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

/** What an account gives Biber: the user's mailbox or calendar. */
export type PersonalAccountKind = 'calendar' | 'mail';

/** Where it lives: a mailbox reached over IMAP and SMTP, or a Feishu calendar. */
export type PersonalAccountProvider = 'feishu' | 'imap';

/** `needs_reauth`: the password or the authorization no longer works, the user must connect again */
export type PersonalAccountStatus = 'active' | 'needs_reauth';

/**
 * Personal accounts - a mailbox or a calendar the user connected for Biber to use on their
 * behalf, one of each kind per user. `settings` holds what is not secret (servers, ports, the
 * calendar id); `credentials` holds the app password or the OAuth tokens, encrypted with the key
 * vault secret. Accounts connected through Composio (Gmail, Google Calendar, Outlook) live with
 * Composio's connectors instead.
 */
export const personalAccounts = pgTable(
  'personal_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    kind: text('kind').$type<PersonalAccountKind>().notNull(),
    provider: text('provider').$type<PersonalAccountProvider>().notNull(),
    /** What the user sees: the mail address, or the Feishu name */
    label: text('label').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Encrypted; never returned to clients */
    credentials: text('credentials').notNull(),

    status: text('status').$type<PersonalAccountStatus>().notNull().default('active'),
    lastError: text('last_error'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('personal_accounts_user_kind_unique').on(t.userId, t.kind)],
);

export type PersonalAccountItem = typeof personalAccounts.$inferSelect;
export type NewPersonalAccount = typeof personalAccounts.$inferInsert;
