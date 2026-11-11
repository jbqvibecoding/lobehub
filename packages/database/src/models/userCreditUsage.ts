import type { CreditPeriod } from '@lobechat/billing';
import { and, eq, sql } from 'drizzle-orm';

import { userCreditUsages } from '../schemas/billing';
import type { LobeChatDatabase } from '../type';

export class UserCreditUsageModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Credits spent in the window that starts at `periodStart`; zero when nothing was spent yet. */
  async getUsed(periodStart: Date): Promise<number> {
    const [row] = await this.db
      .select({ usedCredits: userCreditUsages.usedCredits })
      .from(userCreditUsages)
      .where(
        and(
          eq(userCreditUsages.userId, this.userId),
          eq(userCreditUsages.periodStart, periodStart),
        ),
      )
      .limit(1);

    return row?.usedCredits ?? 0;
  }

  /**
   * Adds to what the window has spent, in one statement, so calls finishing at the same moment
   * are all counted. Returns the window's new total.
   */
  async add(period: CreditPeriod, credits: number): Promise<number> {
    const [row] = await this.db
      .insert(userCreditUsages)
      .values({
        periodEnd: period.end,
        periodStart: period.start,
        usedCredits: credits,
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          updatedAt: new Date(),
          usedCredits: sql`${userCreditUsages.usedCredits} + ${credits}`,
        },
        target: [userCreditUsages.userId, userCreditUsages.periodStart],
      })
      .returning({ usedCredits: userCreditUsages.usedCredits });

    return row.usedCredits;
  }
}
