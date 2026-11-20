import { and, desc, eq, isNotNull, lt } from 'drizzle-orm';

import type { NewProactiveThought } from '../schemas/proactive';
import { proactiveThoughts } from '../schemas/proactive';
import type { LobeChatDatabase } from '../type';

export type ProactiveThoughtDraft = Omit<NewProactiveThought, 'id' | 'status' | 'userId'>;

/** One user's pending-to-say list. */
export class ProactiveThoughtModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(proactiveThoughts.userId, this.userId);

  /**
   * Adds the thoughts not already known by their `sourceRef`, open or not, so nothing is said twice.
   * Returns the ones added.
   */
  async addNew(drafts: ProactiveThoughtDraft[]) {
    if (drafts.length === 0) return [];

    return this.db
      .insert(proactiveThoughts)
      .values(drafts.map((draft) => ({ ...draft, userId: this.userId })))
      .onConflictDoNothing({ target: [proactiveThoughts.userId, proactiveThoughts.sourceRef] })
      .returning();
  }

  /** Thoughts still waiting to be said, newest first. */
  async listOpen() {
    return this.db
      .select()
      .from(proactiveThoughts)
      .where(and(this.ownership(), eq(proactiveThoughts.status, 'open')))
      .orderBy(desc(proactiveThoughts.createdAt));
  }

  /** Open thoughts whose moment has passed become expired. */
  async expireOverdue(now = new Date()) {
    return this.db
      .update(proactiveThoughts)
      .set({ status: 'expired' })
      .where(
        and(
          this.ownership(),
          eq(proactiveThoughts.status, 'open'),
          isNotNull(proactiveThoughts.expiresAt),
          lt(proactiveThoughts.expiresAt, now),
        ),
      )
      .returning({ id: proactiveThoughts.id });
  }

  /** The thought was said: it will not come up again. */
  async markDone(id: string, now = new Date()) {
    const [row] = await this.db
      .update(proactiveThoughts)
      .set({ status: 'done', surfacedAt: now })
      .where(and(eq(proactiveThoughts.id, id), this.ownership()))
      .returning();

    return row;
  }

  /** The user does not want this brought up. Returns whether an open thought was dropped. */
  async drop(id: string) {
    const rows = await this.db
      .update(proactiveThoughts)
      .set({ status: 'dropped' })
      .where(
        and(eq(proactiveThoughts.id, id), this.ownership(), eq(proactiveThoughts.status, 'open')),
      )
      .returning({ id: proactiveThoughts.id });

    return rows.length > 0;
  }
}
