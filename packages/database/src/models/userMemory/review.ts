import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { userMemories, userMemoriesContexts, userMemoryExtractions } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';

/**
 * Deletes memories and every place that carries them: their layer rows (by cascade), the copies an
 * undo record kept (by cascade), and their ids in contexts, which list memories by id rather than
 * by a foreign key and so outlive them. Returns the ids that were deleted.
 */
export const forgetMemories = async (
  tx: Transaction,
  userId: string,
  ids: string[],
): Promise<string[]> => {
  if (ids.length === 0) return [];
  const deleted = (
    await tx
      .delete(userMemories)
      .where(and(inArray(userMemories.id, ids), eq(userMemories.userId, userId)))
      .returning({ id: userMemories.id })
  ).map((row) => row.id);
  if (deleted.length === 0) return [];

  const contexts = await tx
    .select({ id: userMemoriesContexts.id, memoryIds: userMemoriesContexts.userMemoryIds })
    .from(userMemoriesContexts)
    .where(
      and(
        eq(userMemoriesContexts.userId, userId),
        or(
          ...deleted.map(
            (id) => sql`${userMemoriesContexts.userMemoryIds} @> ${JSON.stringify([id])}::jsonb`,
          ),
        ),
      ),
    );
  const gone = new Set(deleted);
  for (const context of contexts) {
    const rest = (context.memoryIds ?? []).filter((memoryId) => !gone.has(memoryId));
    await (rest.length === 0
      ? tx.delete(userMemoriesContexts).where(eq(userMemoriesContexts.id, context.id))
      : tx
          .update(userMemoriesContexts)
          .set({ userMemoryIds: rest })
          .where(eq(userMemoriesContexts.id, context.id)));
  }
  return deleted;
};

export interface ReviewableMemory {
  capturedAt: Date;
  id: string;
  /** `identity`, `preference`, `context`, `experience` or `activity` */
  layer: string | null;
  summary: string | null;
  title: string | null;
}

/**
 * The user's memories of every kind as one list a person can read and prune: newest first, and
 * forgetting one removes everything that carries it, including the situation (context) it belongs
 * to, so the agent can no longer retrieve it.
 */
export class UserMemoryReviewModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  list = async ({ page = 1, pageSize = 30 }: { page?: number; pageSize?: number } = {}) => {
    const size = Math.min(Math.max(pageSize, 1), 100);
    const rows = await this.db
      .select({
        capturedAt: userMemories.capturedAt,
        id: userMemories.id,
        layer: userMemories.memoryLayer,
        summary: userMemories.summary,
        title: userMemories.title,
      })
      .from(userMemories)
      .where(eq(userMemories.userId, this.userId))
      .orderBy(desc(userMemories.capturedAt), desc(userMemories.id))
      .limit(size + 1)
      .offset((Math.max(page, 1) - 1) * size);

    return { hasMore: rows.length > size, items: rows.slice(0, size) as ReviewableMemory[] };
  };

  /** Forgets one memory. False when the user has no memory with that id. */
  forget = async (id: string): Promise<boolean> =>
    this.db.transaction(async (tx) => (await forgetMemories(tx, this.userId, [id])).length > 0);

  /** Forgets every memory, contexts and undo records included. */
  forgetAll = async () => this.db.transaction((tx) => forgetEverything(tx, this.userId));
}

/** Deletes all of a user's memories and everything kept about them, undo records included. */
export const forgetEverything = async (tx: Transaction, userId: string) => {
  await tx.delete(userMemoryExtractions).where(eq(userMemoryExtractions.userId, userId));
  await tx.delete(userMemoriesContexts).where(eq(userMemoriesContexts.userId, userId));
  await tx.delete(userMemories).where(eq(userMemories.userId, userId));
};
