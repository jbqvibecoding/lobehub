import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

/**
 * Saved logins - a website login the user saved on the phone for Biber to sign in with on its
 * cloud computer. `origin` is the one exact site it may be typed into (`https://host[:port]`);
 * `credentials` holds the user name and password, encrypted with the key vault secret, and is
 * never returned to a client or a model. `accountHint` is what may be shown of the user name.
 */
export const savedLogins = pgTable(
  'saved_logins',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** What the user calls it: the site's name unless they gave one */
    label: text('label').notNull(),
    origin: text('origin').notNull(),
    /** The user name with most of it hidden, such as a•••@qq.com */
    accountHint: text('account_hint').notNull(),
    /** Encrypted `{ username, password }`; never returned to clients */
    credentials: text('credentials').notNull(),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saved_logins_user_id_idx').on(t.userId)],
);

export type SavedLoginItem = typeof savedLogins.$inferSelect;
export type NewSavedLogin = typeof savedLogins.$inferInsert;
