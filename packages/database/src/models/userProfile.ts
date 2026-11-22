import type { UserProfileEntry, UserProfileInterview } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import type { UserProfileItem } from '../schemas/userProfile';
import { userProfiles } from '../schemas/userProfile';
import type { LobeChatDatabase } from '../type';

export interface UserProfileState {
  entries: UserProfileEntry[];
  interview: UserProfileInterview;
}

/** What a change hands back: its answer, and the new profile when there is one to write. */
export interface UserProfileChange<T> {
  result: T;
  state?: UserProfileState;
}

/**
 * One user's profile row. Every change reads and writes the row under a lock, so Biber saving an
 * entry and the user editing one on the phone at the same moment both land.
 */
export class UserProfileModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async get(): Promise<UserProfileItem | undefined> {
    const [row] = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, this.userId))
      .limit(1);
    return row;
  }

  /** Runs `change` on the current profile (empty for a new user) and writes what it returns. */
  async update<T>(change: (state: UserProfileState) => UserProfileChange<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.insert(userProfiles).values({ userId: this.userId }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, this.userId))
        .for('update');

      const { result, state } = change({
        entries: row?.entries ?? [],
        interview: row?.interview ?? {},
      });
      if (state) {
        await tx
          .update(userProfiles)
          .set({ entries: state.entries, interview: state.interview, updatedAt: new Date() })
          .where(eq(userProfiles.userId, this.userId));
      }
      return result;
    });
  }
}
