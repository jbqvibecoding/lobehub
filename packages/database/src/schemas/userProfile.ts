import type { UserProfileEntry, UserProfileInterview } from '@lobechat/types';
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { updatedAt } from './_helpers';
import { users } from './user';

/**
 * User profiles - what the user told Biber about themselves (their name, goals, the people and
 * projects in their life, how they like to be spoken to), one row per user. Kept apart from the
 * memory pipeline, which rewrites and deletes its persona document: this is only ever changed by
 * the user, or by Biber when the user says so.
 */
export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey()
    .notNull(),

  entries: jsonb('entries').$type<UserProfileEntry[]>().notNull().default([]),
  interview: jsonb('interview').$type<UserProfileInterview>().notNull().default({}),

  updatedAt: updatedAt(),
});

export type UserProfileItem = typeof userProfiles.$inferSelect;
