import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { ProactiveThoughtModel } from '@/database/models/proactiveThought';
import type { ProactiveThoughtItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { reviewModelReply } from '@/server/services/contentSafety';
import { SystemAgentService } from '@/server/services/systemAgent';

import type { PushChannel } from '../push/PushChannel';
import { fromBiberTopic } from './biber';
import { deliverProactiveMessage } from './delivery';

const log = debug('lobe-server:proactive:asked');

/** At most this many asked-for reminders go out per check. */
export const ASKED_PER_TICK = 500;

/** An asked-for reminder can wait this long past its time (a missed check), then it is dropped. */
export const ASKED_GRACE_MS = 6 * 60 * 60 * 1000;

export type AskedOutcome = 'blocked' | 'failed' | 'no_agent' | 'sent';

/** The reminder as the user reads it: what they asked to be reminded of, in their language. */
export const askedReminderText = (about: string, locale: string) =>
  locale.toLowerCase().startsWith('zh') ? `提醒：${about}` : `Reminder: ${about}`;

/**
 * Sends one reminder the user asked for, already taken off the list: into the "From Biber" chat
 * and to their phones. Its time was the user's, so none of the limits on unprompted messages apply
 * and nothing counts against the day's budget.
 */
const sendAsked = async (
  db: LobeChatDatabase,
  thought: ProactiveThoughtItem,
  push?: Pick<PushChannel, 'deliver'>,
): Promise<AskedOutcome> => {
  const { userId } = thought;
  const biber = await new AgentModel(db, userId).getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
  if (!biber) return 'no_agent';

  const locale = await new SystemAgentService(db, userId).getUserLocale();
  const content = askedReminderText(thought.seed, locale);
  if ((await reviewModelReply(content)) === 'hidden') return 'blocked';

  const settings = new ProactiveSettingsModel(db, userId);
  const topicId = await fromBiberTopic(db, userId, {
    agentId: biber.id,
    locale,
    topicId: (await settings.find())?.topicId,
  });
  const message = await new MessageModel(db, userId).create({
    agentId: biber.id,
    content,
    role: 'assistant',
    topicId,
  });
  await settings.setTopic(topicId);

  await deliverProactiveMessage(
    db,
    userId,
    {
      actionUrl: `/agent/${biber.id}/${topicId}`,
      agentId: biber.id,
      content,
      dedupeKey: `asked:${thought.id}`,
      kind: 'asked',
      ledgerTitle: content,
      messageId: message.id,
      target: { agentId: biber.id, topicId },
      thoughtId: thought.id,
      title: biber.title || 'Biber',
      topicId,
    },
    push,
  );
  return 'sent';
};

/**
 * Sends every reminder users asked for whose time has come, across all users, and drops the ones
 * more than `ASKED_GRACE_MS` late. A reminder that fails to go out goes back on the list for the
 * next check; one the content check stops is not retried.
 */
export const deliverAskedReminders = async (
  db: LobeChatDatabase,
  now: Date,
  push?: Pick<PushChannel, 'deliver'>,
) => {
  const outcomes: Partial<Record<AskedOutcome | 'expired', number>> = {};
  const count = (outcome: AskedOutcome | 'expired', by = 1) => {
    if (by > 0) outcomes[outcome] = (outcomes[outcome] ?? 0) + by;
  };

  count('expired', (await ProactiveThoughtModel.expireOverdueAsked(db, now)).length);

  for (const thought of await ProactiveThoughtModel.takeDueAsked(db, now, ASKED_PER_TICK)) {
    let outcome: AskedOutcome;
    try {
      outcome = await sendAsked(db, thought, push);
    } catch (error) {
      console.error('[proactive] asked reminder %s failed: %O', thought.id, error);
      outcome = 'failed';
    }
    if (outcome === 'failed' || outcome === 'no_agent') {
      await new ProactiveThoughtModel(db, thought.userId).reopen(thought.id);
    }
    log('asked reminder %s for userId=%s: %s', thought.id, thought.userId, outcome);
    count(outcome);
  }

  return outcomes;
};
