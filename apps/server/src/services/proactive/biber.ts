import { isMainlandRegion } from '@lobechat/region';

import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { regionEnv } from '@/envs/region';

const TOPIC_TITLE = { en: 'From Biber', zh: '来自 Biber' };

export const validTimeZone = (timeZone: string | null | undefined) => {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
};

/**
 * The user's time zone: the one their phone reported, else the web setting's, else the edition's
 * home (mainland China for the mainland edition, UTC otherwise). Pass `phoneTimeZone` when the
 * proactive settings row is already loaded.
 */
export const resolveTimeZone = async (
  db: LobeChatDatabase,
  userId: string,
  phoneTimeZone?: string | null,
) => {
  const fromPhone = validTimeZone(
    phoneTimeZone === undefined
      ? (await new ProactiveSettingsModel(db, userId).find())?.timeZone
      : phoneTimeZone,
  );
  if (fromPhone) return fromPhone;

  const userSettings = await new UserModel(db, userId).getUserSettings();
  const fromWeb = validTimeZone(
    (userSettings?.general as { timezone?: string } | undefined)?.timezone,
  );

  return fromWeb ?? (isMainlandRegion(regionEnv.APP_REGION) ? 'Asia/Shanghai' : 'UTC');
};

/** The "From Biber" chat, made the first time Biber writes on its own. */
export const fromBiberTopic = async (
  db: LobeChatDatabase,
  userId: string,
  { agentId, locale, topicId }: { agentId: string; locale: string; topicId?: string | null },
) => {
  const topics = new TopicModel(db, userId);
  if (topicId && (await topics.findById(topicId))) return topicId;

  const topic = await topics.create({
    agentId,
    title: locale.toLowerCase().startsWith('zh') ? TOPIC_TITLE.zh : TOPIC_TITLE.en,
    trigger: 'proactive',
  });
  return topic.id;
};
