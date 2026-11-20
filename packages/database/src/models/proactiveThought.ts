import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from 'drizzle-orm';

import type { NewProactiveThought } from '../schemas/proactive';
import { proactiveThoughts } from '../schemas/proactive';
import type { LobeChatDatabase } from '../type';

export type ProactiveThoughtDraft = Omit<NewProactiveThought, 'id' | 'status' | 'userId'>;

/** Open thoughts one user may have from chats (noted by the agent or asked for), at most */
export const NOTE_LIMIT = 50;

/** A new note did not fit: the user already has `NOTE_LIMIT` open ones from chats. */
export class NoteLimitError extends Error {
  constructor() {
    super(`At most ${NOTE_LIMIT} things can wait to be brought up at once`);
    this.name = 'NoteLimitError';
  }
}

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

  /**
   * Adds one thing to bring up that came from a chat. Throws `NoteLimitError` when the user
   * already has `NOTE_LIMIT` of them open, so a looping agent cannot fill the list.
   */
  async addNote(draft: ProactiveThoughtDraft) {
    const [{ open }] = await this.db
      .select({ open: count() })
      .from(proactiveThoughts)
      .where(
        and(
          this.ownership(),
          eq(proactiveThoughts.status, 'open'),
          inArray(proactiveThoughts.source, ['agent', 'asked']),
        ),
      );
    if (open >= NOTE_LIMIT) throw new NoteLimitError();

    const [row] = await this.db
      .insert(proactiveThoughts)
      .values({ ...draft, userId: this.userId })
      .returning();
    return row;
  }

  async findOpen(id: string) {
    const [row] = await this.db
      .select()
      .from(proactiveThoughts)
      .where(
        and(eq(proactiveThoughts.id, id), this.ownership(), eq(proactiveThoughts.status, 'open')),
      )
      .limit(1);
    return row;
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

  /** Sending a taken reminder failed: it waits for the next check, until it expires. */
  async reopen(id: string) {
    await this.db
      .update(proactiveThoughts)
      .set({ status: 'open', surfacedAt: null })
      .where(
        and(eq(proactiveThoughts.id, id), this.ownership(), eq(proactiveThoughts.status, 'done')),
      );
  }

  /**
   * Reminders users asked for whose time has come, across all users, oldest first. Each is marked
   * done in the same statement, so two checks running at once never send one twice. Ones more
   * than their expiry late are left for `expireOverdueAsked`.
   */
  static async takeDueAsked(db: LobeChatDatabase, now: Date, limit: number) {
    const due = db
      .select({ id: proactiveThoughts.id })
      .from(proactiveThoughts)
      .where(
        and(
          eq(proactiveThoughts.status, 'open'),
          eq(proactiveThoughts.source, 'asked'),
          lte(proactiveThoughts.dueAt, now),
          or(isNull(proactiveThoughts.expiresAt), gte(proactiveThoughts.expiresAt, now)),
        ),
      )
      .orderBy(asc(proactiveThoughts.dueAt))
      .limit(limit);

    return db
      .update(proactiveThoughts)
      .set({ status: 'done', surfacedAt: now })
      .where(and(inArray(proactiveThoughts.id, due), eq(proactiveThoughts.status, 'open')))
      .returning();
  }

  /** Asked reminders that could not go out in time are not sent late. */
  static async expireOverdueAsked(db: LobeChatDatabase, now: Date) {
    return db
      .update(proactiveThoughts)
      .set({ status: 'expired' })
      .where(
        and(
          eq(proactiveThoughts.status, 'open'),
          eq(proactiveThoughts.source, 'asked'),
          isNotNull(proactiveThoughts.expiresAt),
          lt(proactiveThoughts.expiresAt, now),
        ),
      )
      .returning({ id: proactiveThoughts.id });
  }
}
