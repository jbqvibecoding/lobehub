import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';

import { userMemoriesPreferences } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** A preference this important is a standing rule rather than a taste. */
export const STANDING_INSTRUCTION_PRIORITY = 0.8;

/**
 * The memories every run is given verbatim, whatever the conversation is about. The persona summary
 * is rewritten from all memories each time memories are extracted and can drop a fact in the
 * rewrite; these are read from the memories themselves, so they never fade from it.
 */
export class UserMemoryKeyFactsModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Rules the user set for the assistant ("never book before 9am"), most important first. */
  standingInstructions = async (limit = 15) =>
    this.db
      .select({
        conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
        id: userMemoriesPreferences.id,
      })
      .from(userMemoriesPreferences)
      .where(
        and(
          eq(userMemoriesPreferences.userId, this.userId),
          gte(userMemoriesPreferences.scorePriority, STANDING_INSTRUCTION_PRIORITY),
          isNotNull(userMemoriesPreferences.conclusionDirectives),
        ),
      )
      .orderBy(
        desc(userMemoriesPreferences.scorePriority),
        desc(userMemoriesPreferences.capturedAt),
      )
      .limit(limit);
}
