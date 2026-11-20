import { and, count, desc, eq, gte, inArray, lt } from 'drizzle-orm';

import type {
  NewProactiveMessage,
  ProactiveMessageKind,
  ProactiveMessageState,
} from '../schemas/proactive';
import { proactiveMessages } from '../schemas/proactive';
import type { LobeChatDatabase } from '../type';

/** A message nobody opened, dismissed or answered within this long counts as ignored. */
export const IGNORE_AFTER_HOURS = 24;

/** Each state's strength: a message only ever moves to a stronger one. */
const STATE_RANK: Record<ProactiveMessageState, number> = {
  dismissed: 3,
  ignored: 1,
  opened: 2,
  replied: 4,
  sent: 0,
};

const weakerThan = (state: ProactiveMessageState) =>
  (Object.keys(STATE_RANK) as ProactiveMessageState[]).filter(
    (other) => STATE_RANK[other] < STATE_RANK[state],
  );

const STAMP = {
  dismissed: 'dismissedAt',
  opened: 'openedAt',
  replied: 'repliedAt',
} as const;

/** One user's results ledger: the messages Biber sent unprompted, and what became of each. */
export class ProactiveMessageModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(proactiveMessages.userId, this.userId);

  async record(entry: Omit<NewProactiveMessage, 'id' | 'state' | 'userId'>) {
    const [row] = await this.db
      .insert(proactiveMessages)
      .values({ ...entry, userId: this.userId })
      .returning();

    return row;
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(proactiveMessages)
      .where(and(eq(proactiveMessages.id, id), this.ownership()))
      .limit(1);

    return row;
  }

  /**
   * Moves a message to `state` when that is a stronger signal than where it is, and returns it;
   * returns undefined when the message is not the user's or already says as much or more.
   */
  private async advance(id: string, state: keyof typeof STAMP) {
    const [row] = await this.db
      .update(proactiveMessages)
      .set({ [STAMP[state]]: new Date(), state })
      .where(
        and(
          eq(proactiveMessages.id, id),
          this.ownership(),
          inArray(proactiveMessages.state, weakerThan(state)),
        ),
      )
      .returning();

    return row;
  }

  markOpened = (id: string) => this.advance(id, 'opened');

  markDismissed = (id: string) => this.advance(id, 'dismissed');

  markReplied = (id: string) => this.advance(id, 'replied');

  /** This user's messages left without any reaction for a day become ignored. */
  async ignoreOverdue(now = new Date()) {
    return ProactiveMessageModel.ignoreOverdue(this.db, now, this.userId);
  }

  /** The user's newest messages first, for spacing them out and not saying the same thing twice. */
  async recent(limit = 10) {
    return this.db
      .select()
      .from(proactiveMessages)
      .where(this.ownership())
      .orderBy(desc(proactiveMessages.sentAt))
      .limit(limit);
  }

  /** The user's messages sent since `since`, for ruling out kinds they keep dismissing. */
  async listSince(since: Date) {
    return this.db
      .select()
      .from(proactiveMessages)
      .where(and(this.ownership(), gte(proactiveMessages.sentAt, since)))
      .orderBy(desc(proactiveMessages.sentAt));
  }

  /** Every user's messages left without any reaction for a day become ignored. */
  static async ignoreOverdue(db: LobeChatDatabase, now = new Date(), userId?: string) {
    const cutoff = new Date(now.getTime() - IGNORE_AFTER_HOURS * 60 * 60 * 1000);

    return db
      .update(proactiveMessages)
      .set({ state: 'ignored' })
      .where(
        and(
          eq(proactiveMessages.state, 'sent'),
          lt(proactiveMessages.sentAt, cutoff),
          userId ? eq(proactiveMessages.userId, userId) : undefined,
        ),
      )
      .returning({ id: proactiveMessages.id });
  }

  /** How many messages of each kind (and routine) ended in each state, since `since`. */
  static async countByState(db: LobeChatDatabase, since: Date) {
    return db
      .select({
        count: count(),
        kind: proactiveMessages.kind,
        routineId: proactiveMessages.routineId,
        state: proactiveMessages.state,
      })
      .from(proactiveMessages)
      .where(gte(proactiveMessages.sentAt, since))
      .groupBy(proactiveMessages.kind, proactiveMessages.routineId, proactiveMessages.state);
  }
}

export interface ProactiveStatsRow {
  /** Messages still waiting for a reaction: not yet part of any rate */
  awaiting: number;
  dismissRate: number;
  ignoreRate: number;
  kind: ProactiveMessageKind;
  /** Opened, dismissed or replied to: the user saw it */
  openRate: number;
  replyRate: number;
  routineId: string | null;
  sent: number;
}

/**
 * Rates per kind and routine from the ledger's counts. A message counts as opened when the user
 * opened, dismissed or replied to it, and the rates leave out messages still within their day.
 */
export const summarizeProactiveStats = (
  counts: { count: number; kind: ProactiveMessageKind; routineId: string | null; state: string }[],
): ProactiveStatsRow[] => {
  const groups = new Map<string, Record<ProactiveMessageState, number> & ProactiveStatsRow>();

  for (const row of counts) {
    const key = `${row.kind}|${row.routineId ?? ''}`;
    const group =
      groups.get(key) ??
      ({
        awaiting: 0,
        dismissRate: 0,
        dismissed: 0,
        ignoreRate: 0,
        ignored: 0,
        kind: row.kind,
        openRate: 0,
        opened: 0,
        replied: 0,
        replyRate: 0,
        routineId: row.routineId,
        sent: 0,
      } as Record<ProactiveMessageState, number> & ProactiveStatsRow);
    group[row.state as ProactiveMessageState] += Number(row.count);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const awaiting = group.sent;
    const settled = group.ignored + group.opened + group.dismissed + group.replied;
    const rate = (value: number) => (settled === 0 ? 0 : value / settled);

    return {
      awaiting,
      dismissRate: rate(group.dismissed),
      ignoreRate: rate(group.ignored),
      kind: group.kind,
      openRate: rate(group.opened + group.dismissed + group.replied),
      replyRate: rate(group.replied),
      routineId: group.routineId,
      sent: awaiting + settled,
    };
  });
};
