import { and, desc, eq, sql } from 'drizzle-orm';

import { userMemories, userMemoriesContexts } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

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
    this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(userMemories)
        .where(and(eq(userMemories.id, id), eq(userMemories.userId, this.userId)))
        .returning({ id: userMemories.id });
      if (deleted.length === 0) return false;

      // A context lists its memories by id rather than by a foreign key, so it outlives them
      const contexts = await tx
        .select({ id: userMemoriesContexts.id, memoryIds: userMemoriesContexts.userMemoryIds })
        .from(userMemoriesContexts)
        .where(
          and(
            eq(userMemoriesContexts.userId, this.userId),
            sql`${userMemoriesContexts.userMemoryIds} @> ${JSON.stringify([id])}::jsonb`,
          ),
        );
      for (const context of contexts) {
        const rest = (context.memoryIds ?? []).filter((memoryId) => memoryId !== id);
        await (rest.length === 0
          ? tx.delete(userMemoriesContexts).where(eq(userMemoriesContexts.id, context.id))
          : tx
              .update(userMemoriesContexts)
              .set({ userMemoryIds: rest })
              .where(eq(userMemoriesContexts.id, context.id)));
      }
      return true;
    });

  /** Forgets every memory, contexts included. */
  forgetAll = async () =>
    this.db.transaction(async (tx) => {
      await tx.delete(userMemoriesContexts).where(eq(userMemoriesContexts.userId, this.userId));
      await tx.delete(userMemories).where(eq(userMemories.userId, this.userId));
    });
}
