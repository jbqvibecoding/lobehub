import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createNanoId } from '../../utils/idGenerator';
import { createdAt, varchar255 } from '../_helpers';
import { topics } from '../topic';
import { users } from '../user';
import { userMemories } from './base';

/**
 * An identity memory as it was before a memory extraction changed or removed it: its base row and
 * its identity row, embeddings included, as JSON (dates become ISO strings).
 */
export interface IdentityMemorySnapshot {
  identity: Record<string, unknown>;
  memory: Record<string, unknown>;
}

export type MemoryExtractionChangeKind = 'removed' | 'updated';

/**
 * One memory extraction from a conversation, kept so the user can undo it: what it added, and in
 * `userMemoryExtractionChanges` what it changed or removed. Only the latest few are kept.
 */
export const userMemoryExtractions = pgTable(
  'user_memory_extractions',
  {
    id: varchar255('id')
      .$defaultFn(() => createNanoId(18)())
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),

    /** Base memory ids the extraction created; ids only, so nothing here outlives a forget */
    addedMemoryIds: jsonb('added_memory_ids').$type<string[]>().notNull().default([]),

    createdAt: createdAt(),
  },
  (table) => [
    index('user_memory_extractions_user_id_created_at_index').on(table.userId, table.createdAt),
  ],
);

/**
 * A memory an extraction changed or removed, with its content from before. While the memory still
 * exists, `liveMemoryId` points at it, so deleting the memory in any way also deletes this copy.
 */
export const userMemoryExtractionChanges = pgTable(
  'user_memory_extraction_changes',
  {
    id: varchar255('id')
      .$defaultFn(() => createNanoId(18)())
      .primaryKey(),

    extractionId: varchar255('extraction_id')
      .references(() => userMemoryExtractions.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    kind: text('kind').$type<MemoryExtractionChangeKind>().notNull(),
    memoryId: varchar255('memory_id').notNull(),
    liveMemoryId: varchar255('live_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    before: jsonb('before').$type<IdentityMemorySnapshot>().notNull(),
    /** Fingerprint of what the extraction left; a different one means it was changed since */
    afterFingerprint: text('after_fingerprint'),

    createdAt: createdAt(),
  },
  (table) => [
    index('user_memory_extraction_changes_extraction_id_index').on(table.extractionId),
    index('user_memory_extraction_changes_live_memory_id_index').on(table.liveMemoryId),
  ],
);

export type UserMemoryExtraction = typeof userMemoryExtractions.$inferSelect;
export type UserMemoryExtractionChange = typeof userMemoryExtractionChanges.$inferSelect;
