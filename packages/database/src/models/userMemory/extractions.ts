import { and, count, desc, eq, getTableColumns, inArray, notInArray, sql } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

import {
  type IdentityMemorySnapshot,
  type MemoryExtractionChangeKind,
  topics,
  userMemories,
  userMemoriesIdentities,
  userMemoryExtractionChanges,
  userMemoryExtractions,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { forgetMemories } from './review';

/** How many extractions a user can undo: the latest ones. Older records are deleted on write. */
export const KEPT_EXTRACTIONS = 10;

/** What an extraction changed or removed, as `record` keeps it. */
export interface TrackedIdentityChange {
  afterFingerprint?: string;
  before: IdentityMemorySnapshot;
  kind: MemoryExtractionChangeKind;
  memoryId: string;
}

export interface RecentMemoryExtraction {
  /** Memories it added that still exist */
  added: number;
  /** Memories it changed or removed that can still be put back */
  changed: number;
  createdAt: Date;
  id: string;
  /** The conversation it learned from; null once that conversation is deleted */
  topicTitle: string | null;
}

export interface MemoryExtractionUndo {
  forgotten: number;
  /** Titles of memories changed since the extraction, which were left as they are */
  notRestored: string[];
  restored: number;
}

type Db = LobeChatDatabase | Transaction;

/** Columns that say what a memory says; access counters and timestamps are left out. */
const MEMORY_CONTENT = ['title', 'summary', 'details', 'memoryCategory', 'memoryType', 'tags'];
const IDENTITY_CONTENT = ['description', 'relationship', 'role', 'type', 'episodicDate', 'tags'];

/** cyrb53: a fast 53-bit string hash, enough to tell whether content changed. */
const hash = (text: string) => {
  let h1 = 0xde_ad_be_ef;
  let h2 = 0x41_c6_ce_57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  return (4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)).toString(36);
};

const fingerprint = (snapshot: IdentityMemorySnapshot) =>
  hash(
    JSON.stringify([
      MEMORY_CONTENT.map((key) => snapshot.memory[key] ?? null),
      IDENTITY_CONTENT.map((key) => snapshot.identity[key] ?? null),
    ]),
  );

const titleOf = (snapshot: IdentityMemorySnapshot) =>
  String(snapshot.memory.title ?? snapshot.identity.description ?? '');

/** A stored row back into column values: only the table's columns, dates as dates. */
const toColumns = (table: AnyPgTable, row: Record<string, unknown>, omit: string[] = []) =>
  Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([key]) => key in row && !omit.includes(key))
      .map(([key, column]) => {
        const value = row[key];
        return [
          key,
          column.dataType === 'date' && typeof value === 'string' ? new Date(value) : value,
        ];
      }),
  );

/** Columns a restore leaves alone: identity, ownership, and what records use rather than content */
const KEEP_ON_RESTORE = [
  'id',
  'userId',
  'userMemoryId',
  'createdAt',
  'updatedAt',
  'accessedAt',
  'accessedCount',
  'lastAccessedAt',
];

/**
 * Undo records for memory extractions. When an extraction learns from a conversation, it records
 * what it added and, for identity memories it rewrote or removed, what they said before; undoing
 * takes the additions back, puts the old versions back, and marks the conversation so it is not
 * learned from again. A forgotten memory leaves no copy here: copies of a live memory are deleted
 * with it by foreign key, and forgetting everything deletes every record.
 */
export class UserMemoryExtractionModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Runs `change` on an identity memory and returns what to keep to undo it, or undefined when
   * there is no such memory. `change` runs either way.
   */
  trackIdentityChange = async (
    identityId: string,
    kind: MemoryExtractionChangeKind,
    change: () => Promise<unknown>,
  ): Promise<TrackedIdentityChange | undefined> => {
    const identity = await this.db.query.userMemoriesIdentities.findFirst({
      columns: { userMemoryId: true },
      where: and(
        eq(userMemoriesIdentities.id, identityId),
        eq(userMemoriesIdentities.userId, this.userId),
      ),
    });
    const memoryId = identity?.userMemoryId;
    const before = memoryId ? await this.snapshot(this.db, memoryId) : undefined;
    await change();
    if (!memoryId || !before) return undefined;
    if (kind === 'removed') return { before, kind, memoryId };

    const after = await this.snapshot(this.db, memoryId);
    return after ? { afterFingerprint: fingerprint(after), before, kind, memoryId } : undefined;
  };

  /** Keeps what one extraction did; nothing when it wrote nothing. Returns the record's id. */
  record = async ({
    addedMemoryIds,
    changes,
    topicId,
  }: {
    addedMemoryIds: string[];
    changes: TrackedIdentityChange[];
    topicId?: string | null;
  }): Promise<string | undefined> => {
    if (addedMemoryIds.length === 0 && changes.length === 0) return undefined;

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(userMemoryExtractions)
        .values({ addedMemoryIds, topicId, userId: this.userId })
        .returning({ id: userMemoryExtractions.id });

      // A memory deleted meanwhile has nothing left to put back, and must leave no copy
      const live = await this.existing(
        tx,
        changes.filter((change) => change.kind === 'updated').map((change) => change.memoryId),
      );
      const rows = changes
        .filter((change) => change.kind === 'removed' || live.has(change.memoryId))
        .map((change) => ({
          afterFingerprint: change.afterFingerprint,
          before: change.before,
          extractionId: record.id,
          kind: change.kind,
          liveMemoryId: change.kind === 'updated' ? change.memoryId : null,
          memoryId: change.memoryId,
          userId: this.userId,
        }));
      if (rows.length > 0) await tx.insert(userMemoryExtractionChanges).values(rows);

      const kept = tx
        .select({ id: userMemoryExtractions.id })
        .from(userMemoryExtractions)
        .where(eq(userMemoryExtractions.userId, this.userId))
        .orderBy(desc(userMemoryExtractions.createdAt), desc(userMemoryExtractions.id))
        .limit(KEPT_EXTRACTIONS);
      await tx
        .delete(userMemoryExtractions)
        .where(
          and(
            eq(userMemoryExtractions.userId, this.userId),
            notInArray(userMemoryExtractions.id, kept),
          ),
        );

      return record.id;
    });
  };

  /** The extractions that can still be undone, newest first. */
  list = async (): Promise<RecentMemoryExtraction[]> => {
    const records = await this.db
      .select({
        addedMemoryIds: userMemoryExtractions.addedMemoryIds,
        createdAt: userMemoryExtractions.createdAt,
        id: userMemoryExtractions.id,
        topicTitle: topics.title,
      })
      .from(userMemoryExtractions)
      .leftJoin(topics, eq(topics.id, userMemoryExtractions.topicId))
      .where(eq(userMemoryExtractions.userId, this.userId))
      .orderBy(desc(userMemoryExtractions.createdAt), desc(userMemoryExtractions.id))
      .limit(KEPT_EXTRACTIONS);
    if (records.length === 0) return [];

    const changeCounts = await this.db
      .select({ changed: count(), extractionId: userMemoryExtractionChanges.extractionId })
      .from(userMemoryExtractionChanges)
      .where(
        inArray(
          userMemoryExtractionChanges.extractionId,
          records.map((record) => record.id),
        ),
      )
      .groupBy(userMemoryExtractionChanges.extractionId);
    const changed = new Map(changeCounts.map((row) => [row.extractionId, row.changed]));
    const live = await this.existing(
      this.db,
      records.flatMap((record) => record.addedMemoryIds),
    );

    return records
      .map(({ addedMemoryIds, createdAt, id, topicTitle }) => ({
        added: addedMemoryIds.filter((memoryId) => live.has(memoryId)).length,
        changed: changed.get(id) ?? 0,
        createdAt,
        id,
        topicTitle,
      }))
      .filter((item) => item.added + item.changed > 0);
  };

  /** Undoes one extraction; undefined when the user has no such record. */
  undo = async (id: string): Promise<MemoryExtractionUndo | undefined> =>
    this.db.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(userMemoryExtractions)
        .where(
          and(eq(userMemoryExtractions.id, id), eq(userMemoryExtractions.userId, this.userId)),
        );
      if (!record) return undefined;

      const changes = await tx
        .select()
        .from(userMemoryExtractionChanges)
        .where(eq(userMemoryExtractionChanges.extractionId, id));
      const forgotten = await forgetMemories(tx, this.userId, record.addedMemoryIds);

      let restored = 0;
      const notRestored: string[] = [];
      for (const change of changes) {
        const current = await this.snapshot(tx, change.memoryId);
        const unchanged =
          change.kind === 'updated'
            ? !!current && fingerprint(current) === change.afterFingerprint
            : !current;
        if (!unchanged) {
          const title = titleOf(current ?? change.before);
          if (title) notRestored.push(title);
          continue;
        }
        await (change.kind === 'updated'
          ? this.putBack(tx, change.before)
          : this.reinsert(tx, change.before));
        restored++;
      }

      if (record.topicId) {
        await tx
          .update(topics)
          .set({
            metadata: sql`coalesce(${topics.metadata}, '{}'::jsonb) || '{"userMemoryExtractUndone":true}'::jsonb`,
          })
          .where(and(eq(topics.id, record.topicId), eq(topics.userId, this.userId)));
      }
      await tx.delete(userMemoryExtractions).where(eq(userMemoryExtractions.id, id));

      return { forgotten: forgotten.length, notRestored, restored };
    });

  /** A memory and its identity row as JSON, the way a record keeps them. */
  private snapshot = async (
    db: Db,
    memoryId: string,
  ): Promise<IdentityMemorySnapshot | undefined> => {
    const [memory] = await db
      .select()
      .from(userMemories)
      .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, this.userId)));
    if (!memory) return undefined;
    const [identity] = await db
      .select()
      .from(userMemoriesIdentities)
      .where(
        and(
          eq(userMemoriesIdentities.userMemoryId, memoryId),
          eq(userMemoriesIdentities.userId, this.userId),
        ),
      );
    // As jsonb gives it back, dates as strings, so fingerprints of stored and live copies agree
    // eslint-disable-next-line unicorn/prefer-structured-clone
    return JSON.parse(JSON.stringify({ identity: identity ?? {}, memory }));
  };

  private existing = async (db: Db, ids: string[]) => {
    if (ids.length === 0) return new Set<string>();
    const rows = await db
      .select({ id: userMemories.id })
      .from(userMemories)
      .where(and(inArray(userMemories.id, ids), eq(userMemories.userId, this.userId)));
    return new Set(rows.map((row) => row.id));
  };

  private putBack = async (tx: Transaction, before: IdentityMemorySnapshot) => {
    await tx
      .update(userMemories)
      .set(toColumns(userMemories, before.memory, KEEP_ON_RESTORE))
      .where(
        and(eq(userMemories.id, String(before.memory.id)), eq(userMemories.userId, this.userId)),
      );
    if (!before.identity.id) return;
    await tx
      .update(userMemoriesIdentities)
      .set(toColumns(userMemoriesIdentities, before.identity, KEEP_ON_RESTORE))
      .where(
        and(
          eq(userMemoriesIdentities.id, String(before.identity.id)),
          eq(userMemoriesIdentities.userId, this.userId),
        ),
      );
  };

  private reinsert = async (tx: Transaction, before: IdentityMemorySnapshot) => {
    await tx
      .insert(userMemories)
      .values({ ...toColumns(userMemories, before.memory), userId: this.userId } as never);
    if (!before.identity.id) return;
    await tx.insert(userMemoriesIdentities).values({
      ...toColumns(userMemoriesIdentities, before.identity),
      userId: this.userId,
    } as never);
  };
}
