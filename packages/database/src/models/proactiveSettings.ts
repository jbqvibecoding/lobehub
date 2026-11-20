import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { ProactiveSettingsItem } from '../schemas/proactive';
import { proactiveSettings } from '../schemas/proactive';
import type { LobeChatDatabase } from '../type';

/** What the user can change about unprompted messages. */
export type ProactivePreferences = Pick<
  ProactiveSettingsItem,
  'cooldownUntil' | 'level' | 'quietEnd' | 'quietStart' | 'timeZone'
>;

/** The defaults: reminders and follow-ups, quiet from 22:00 to 08:00. */
export const DEFAULT_PROACTIVE_PREFERENCES: ProactivePreferences = {
  cooldownUntil: null,
  level: 'standard',
  quietEnd: 8,
  quietStart: 22,
  timeZone: null,
};

/** One user's proactive settings and the bookkeeping that spaces messages out. */
export class ProactiveSettingsModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(proactiveSettings.userId, this.userId);

  /** The user's row, or undefined when they never changed anything and nothing was sent. */
  async find() {
    const [row] = await this.db.select().from(proactiveSettings).where(this.ownership()).limit(1);
    return row;
  }

  /** What the user chose, falling back to the defaults. */
  async preferences(): Promise<ProactivePreferences> {
    const row = await this.find();
    if (!row) return DEFAULT_PROACTIVE_PREFERENCES;

    const { cooldownUntil, level, quietEnd, quietStart, timeZone } = row;
    return { cooldownUntil, level, quietEnd, quietStart, timeZone };
  }

  async update(patch: Partial<ProactivePreferences>) {
    const [row] = await this.db
      .insert(proactiveSettings)
      .values({ ...patch, userId: this.userId })
      .onConflictDoUpdate({
        set: { ...patch, updatedAt: new Date() },
        target: proactiveSettings.userId,
      })
      .returning();

    return row;
  }

  /**
   * Takes this user for one proactive check: records the attempt and returns the settings, unless
   * another check attempted within `retryGapMs` (then undefined). That also keeps two checks from
   * running for the same user at once.
   */
  async claim(now: Date, retryGapMs: number) {
    await this.db
      .insert(proactiveSettings)
      .values({ userId: this.userId })
      .onConflictDoNothing({ target: proactiveSettings.userId });

    const [row] = await this.db
      .update(proactiveSettings)
      .set({ lastAttemptAt: now })
      .where(
        and(
          this.ownership(),
          or(
            isNull(proactiveSettings.lastAttemptAt),
            lt(proactiveSettings.lastAttemptAt, new Date(now.getTime() - retryGapMs)),
          ),
        ),
      )
      .returning();

    return row;
  }

  /** Counts a sent message against the budget of the user's local day `budgetDate`. */
  async recordSend({
    budgetDate,
    now,
    topicId,
  }: {
    budgetDate: string;
    now: Date;
    topicId?: string;
  }) {
    const [row] = await this.db
      .update(proactiveSettings)
      .set({
        budgetDate,
        lastSentAt: now,
        spentToday: sql`case when ${proactiveSettings.budgetDate} = ${budgetDate} then ${proactiveSettings.spentToday} + 1 else 1 end`,
        ...(topicId && { topicId }),
      })
      .where(this.ownership())
      .returning();

    return row;
  }
}
