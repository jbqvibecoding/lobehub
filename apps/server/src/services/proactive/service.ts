import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import debug from 'debug';
import { and, desc, eq, gt, inArray, isNotNull, max, ne, sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { ProactiveThoughtModel } from '@/database/models/proactiveThought';
import {
  messages,
  proactiveMessages,
  userMemories,
  userMemoriesActivities,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { reviewModelReply } from '@/server/services/contentSafety';
import { SystemAgentService } from '@/server/services/systemAgent';

import { fromBiberTopic, resolveTimeZone } from './biber';
import { bannedKinds, ignoredStreak, selectCandidates } from './candidates';
import { composeProactiveMessage } from './compose';
import { deliverProactiveMessage } from './delivery';
import { deriveThoughts, FOLLOW_UP_WITHIN_MS, REMIND_AHEAD_MS } from './derive';
import { decideTiming, localTime, RETRY_GAP_MS, type TimingVerdict } from './timing';

const log = debug('lobe-server:proactive');

const DAY = 24 * 60 * 60 * 1000;
/** How far back the ledger is read for kinds the user keeps dismissing. */
const BAN_WINDOW_MS = 30 * DAY;
/** How far back unanswered messages are checked for a reply in their chat. */
const REPLY_WINDOW_MS = 3 * DAY;

export type ProactiveRunResult =
  | { messageId: string; outcomeId: string; sent: true }
  | {
      reason: 'blocked' | 'busy' | 'model_skipped' | 'no_agent' | 'no_candidates' | TimingVerdict;
      sent: false;
    };

/**
 * Runs Biber's proactive check for one user: keeps the pending-to-say list and the results ledger
 * up to date, decides whether now is a moment to speak, and if so, has the model write one short
 * message about the most pressing thing, writes it into the "From Biber" chat and pushes it.
 */
export class ProactiveService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async runForUser(now = new Date()): Promise<ProactiveRunResult> {
    const settings = await new ProactiveSettingsModel(this.db, this.userId).claim(
      now,
      RETRY_GAP_MS,
    );
    if (!settings) return { reason: 'busy', sent: false };

    const ledger = new ProactiveMessageModel(this.db, this.userId);
    await ledger.ignoreOverdue(now);
    await this.recordReplies(ledger, now);

    const biber = await new AgentModel(this.db, this.userId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.inbox,
    );
    if (!biber) return { reason: 'no_agent', sent: false };

    const thoughts = new ProactiveThoughtModel(this.db, this.userId);
    await thoughts.addNew(deriveThoughts(await this.rememberedActivities(now), now, biber.id));
    await thoughts.expireOverdue(now);

    const timeZone = await resolveTimeZone(this.db, this.userId, settings.timeZone);
    const today = localTime(now, timeZone).date;
    const recent = await ledger.recent(20);
    const verdict = decideTiming({
      cooldownUntil: settings.cooldownUntil,
      ignoredStreak: ignoredStreak(recent),
      lastSentAt: settings.lastSentAt,
      lastUserMessageAt: await this.lastUserMessageAt(),
      level: settings.level,
      now,
      quietEnd: settings.quietEnd,
      quietStart: settings.quietStart,
      spentToday: settings.budgetDate === today ? settings.spentToday : 0,
      timeZone,
    });
    if (verdict !== 'ok') return this.skip(verdict);

    const candidates = selectCandidates(await thoughts.listOpen(), {
      banned: bannedKinds(await ledger.listSince(new Date(now.getTime() - BAN_WINDOW_MS))),
      level: settings.level,
      now,
    });
    if (candidates.length === 0) return this.skip('no_candidates');

    const locale = await new SystemAgentService(this.db, this.userId).getUserLocale();
    const composed = await composeProactiveMessage(this.db, this.userId, {
      candidates,
      locale,
      now,
      recent: recent
        .filter((message) => message.kind !== 'routine' && message.title)
        .slice(0, 4)
        .map((message) => message.title!),
      timeZone,
    });
    if (composed.skip) return this.skip('model_skipped');
    if ((await reviewModelReply(composed.content)) === 'hidden') return this.skip('blocked');

    const thought = candidates.find((candidate) => candidate.id === composed.thoughtId)!;
    const topicId = await fromBiberTopic(this.db, this.userId, {
      agentId: biber.id,
      locale,
      topicId: settings.topicId,
    });
    const message = await new MessageModel(this.db, this.userId).create({
      agentId: biber.id,
      content: composed.content,
      role: 'assistant',
      topicId,
    });

    await thoughts.markDone(thought.id, now);
    await new ProactiveSettingsModel(this.db, this.userId).recordSend({
      budgetDate: today,
      now,
      topicId,
    });

    const outcome = await deliverProactiveMessage(this.db, this.userId, {
      actionUrl: `/agent/${biber.id}/${topicId}`,
      agentId: biber.id,
      content: composed.content,
      dedupeKey: `proactive:${thought.id}`,
      kind: thought.kind,
      ledgerTitle: composed.content,
      messageId: message.id,
      target: { agentId: biber.id, topicId },
      thoughtId: thought.id,
      title: biber.title || 'Biber',
      topicId,
    });

    log('sent %s to userId=%s (thought=%s)', thought.kind, this.userId, thought.id);
    return { messageId: message.id, outcomeId: outcome?.id ?? '', sent: true };
  }

  private skip(reason: Exclude<ProactiveRunResult, { sent: true }>['reason']): ProactiveRunResult {
    log('skip userId=%s: %s', this.userId, reason);
    return { reason, sent: false };
  }

  /** A message counts as answered once the user wrote in its chat after it arrived. */
  private async recordReplies(ledger: ProactiveMessageModel, now: Date) {
    const open = await this.db
      .select({
        id: proactiveMessages.id,
        sentAt: proactiveMessages.sentAt,
        topicId: proactiveMessages.topicId,
      })
      .from(proactiveMessages)
      .where(
        and(
          eq(proactiveMessages.userId, this.userId),
          ne(proactiveMessages.kind, 'routine'),
          inArray(proactiveMessages.state, ['ignored', 'opened', 'sent']),
          isNotNull(proactiveMessages.topicId),
          gt(proactiveMessages.sentAt, new Date(now.getTime() - REPLY_WINDOW_MS)),
        ),
      );

    for (const message of open) {
      const [reply] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.userId, this.userId),
            eq(messages.topicId, message.topicId!),
            eq(messages.role, 'user'),
            gt(messages.createdAt, message.sentAt),
          ),
        )
        .limit(1);
      if (reply) await ledger.markReplied(message.id);
    }
  }

  /** Activities in the user's memory that start soon or ended lately, with what they are. */
  private async rememberedActivities(now: Date) {
    const ahead = new Date(now.getTime() + REMIND_AHEAD_MS);
    const behind = new Date(now.getTime() - FOLLOW_UP_WITHIN_MS);
    const endedAt = sql`coalesce(${userMemoriesActivities.endsAt}, ${userMemoriesActivities.startsAt})`;

    const rows = await this.db
      .select({
        endsAt: userMemoriesActivities.endsAt,
        id: userMemoriesActivities.id,
        narrative: userMemoriesActivities.narrative,
        startsAt: userMemoriesActivities.startsAt,
        status: userMemoriesActivities.status,
        title: userMemories.title,
        type: userMemoriesActivities.type,
      })
      .from(userMemoriesActivities)
      .leftJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
      .where(
        and(
          eq(userMemoriesActivities.userId, this.userId),
          sql`((${userMemoriesActivities.startsAt} > ${now} and ${userMemoriesActivities.startsAt} <= ${ahead}) or (${endedAt} >= ${behind} and ${endedAt} <= ${now}))`,
        ),
      )
      .orderBy(desc(userMemoriesActivities.startsAt))
      .limit(50);

    return rows.map((row) => ({
      endsAt: row.endsAt,
      id: row.id,
      startsAt: row.startsAt,
      status: row.status,
      summary: row.title || row.narrative || row.type,
    }));
  }

  private async lastUserMessageAt() {
    const [row] = await this.db
      .select({ at: max(messages.createdAt) })
      .from(messages)
      .where(and(eq(messages.userId, this.userId), eq(messages.role, 'user')));

    return row?.at ?? null;
  }

  /**
   * Users worth a check now, longest unchecked first: not turned off, and with something due on
   * their pending-to-say list or an activity in memory that starts soon or just ended. Reminders
   * the user asked for are sent on their own (see `asked.ts`), so they do not count here.
   */
  static async dueUsers(db: LobeChatDatabase, now: Date, limit = 200) {
    const ahead = new Date(now.getTime() + REMIND_AHEAD_MS);
    const behind = new Date(now.getTime() - FOLLOW_UP_WITHIN_MS);

    const result = await db.execute(sql`
      select u.id
      from users u
      left join proactive_settings s on s.user_id = u.id
      where coalesce(s.level, 'standard') <> 'off'
        and (
          exists (
            select 1 from proactive_thoughts t
            where t.user_id = u.id
              and t.status = 'open'
              and t.source <> 'asked'
              and (t.due_at is null or t.due_at <= ${now})
          )
          or exists (
            select 1 from user_memories_activities a
            where a.user_id = u.id
              and (
                (a.starts_at > ${now} and a.starts_at <= ${ahead})
                or (coalesce(a.ends_at, a.starts_at) between ${behind} and ${now})
              )
          )
        )
      order by s.last_attempt_at asc nulls first
      limit ${limit}
    `);

    return (result.rows as { id: string }[]).map((row) => row.id);
  }
}
