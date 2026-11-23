import { isMainlandRegion } from '@lobechat/region';
import { RequestTrigger, type UserGeneralConfig } from '@lobechat/types';
import debug from 'debug';
import { and, desc, eq } from 'drizzle-orm';

import { agents, messagePlugins, messages, topics, userSettings } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { regionEnv } from '@/envs/region';

import { expertMarketIdentifier } from './catalog';

const log = debug('lobe-server:experts:delivery-check');

/** The experts whose replies are checked: they hand over files, so a file they name must exist. */
export const FILE_EXPERTS = ['documents'];

/** How a delivery check opens, so a check is never itself checked. */
const PREFIXES = { en: '(Delivery check)', zh: '（交付核对）' };

/** File names a reply can claim to have made: what the documents expert hands over. */
const FILE_NAME =
  /[^\s"#'()*,/:;<>?[\\\]`|~，。：；“”‘’（）【】《》「」『』、]+\.(?:csv|docx|html|md|pdf|pptx|xlsx)(?![\dA-Z]|\.[\dA-Z])/giu;

const unique = (names: string[]) => {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The file names a text mentions, each once, as written. */
export const fileNamesIn = (text: string) => unique(text.match(FILE_NAME) ?? []);

export const isDeliveryCheck = (text: string) =>
  Object.values(PREFIXES).some((prefix) => text.trimStart().startsWith(prefix));

/**
 * The files a reply names but that were never handed over in the chat, leaving out the ones the
 * user named themselves (their own uploads, a file they asked about).
 */
export const undeliveredFiles = ({
  delivered,
  reply,
  userText,
}: {
  delivered: string[];
  reply: string;
  userText: string;
}) => {
  const known = [...delivered, ...fileNamesIn(userText)].map((name) => name.toLowerCase());
  // Chinese runs words into a name ("已生成报告.pptx") and names may hold spaces ("Plan v2.docx"),
  // so a name counts as known when it and a known one end the same way
  return fileNamesIn(reply).filter((name) => {
    const claimed = name.toLowerCase();
    return !known.some((other) => claimed.endsWith(other) || other.endsWith(claimed));
  });
};

/** The message the follow-up run answers, in the user's language. */
export const deliveryCheckPrompt = (missing: string[], locale: string) => {
  const files = missing.join(locale.toLowerCase().startsWith('zh') ? '、' : ', ');
  return locale.toLowerCase().startsWith('zh')
    ? `${PREFIXES.zh}你在回复里提到了 ${files}，但这个对话里还没有交付它。请生成并用 exportFile 交付；做不到的话，直接说明原因。`
    : `${PREFIXES.en} Your reply names ${files}, but it was not handed over in this chat. Generate it and deliver it with exportFile; if you cannot, say so plainly.`;
};

interface CheckInput {
  agentId?: string;
  /** The reply that just finished */
  reply: string;
  topicId?: string;
}

/**
 * After a file-making expert's reply: if it names a file that was never handed over in this chat,
 * runs the expert once more in the same chat, with a visible note saying which file is missing.
 * A reply to that note is not checked again, so a file the expert cannot make costs one extra run.
 */
export const checkFileDelivery = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  { agentId, reply, topicId }: CheckInput,
) => {
  if (!agentId || !topicId || !reply.trim()) return;

  const [agent] = await db
    .select({ marketIdentifier: agents.marketIdentifier })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);
  if (!FILE_EXPERTS.some((id) => agent?.marketIdentifier === expertMarketIdentifier(id))) return;

  const [topic] = await db
    .select({ groupId: topics.groupId })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);
  if (!topic) return;

  const [lastUser] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(eq(messages.topicId, topicId), eq(messages.userId, userId), eq(messages.role, 'user')),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const userText = lastUser?.content ?? '';
  if (isDeliveryCheck(userText)) return;

  const exports = await db
    .select({ state: messagePlugins.state })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(
      and(
        eq(messages.topicId, topicId),
        eq(messagePlugins.userId, userId),
        eq(messagePlugins.identifier, 'lobe-cloud-sandbox'),
        eq(messagePlugins.apiName, 'exportFile'),
      ),
    );
  const delivered = exports
    .map(({ state }) => state as { filename?: string; success?: boolean } | null)
    .filter((state) => state?.success && state.filename)
    .map((state) => state!.filename!);

  const missing = undeliveredFiles({ delivered, reply, userText });
  if (missing.length === 0) return;

  const locale = await checkLocale(db, userId);
  log('topic %s: %s named but not delivered; asking once more', topicId, missing.join(', '));
  // Loaded here: the agent service sits above the run lifecycle that calls this
  const { AiAgentService } = await import('@/server/services/aiAgent');
  await new AiAgentService(db, userId, { workspaceId }).execAgent({
    agentId,
    appContext: { groupId: topic.groupId ?? undefined, topicId },
    prompt: deliveryCheckPrompt(missing, locale),
    trigger: RequestTrigger.Chat,
  });
};

/** The user's response language; without one, the edition's: a new mainland account reads Chinese. */
const checkLocale = async (db: LobeChatDatabase, userId: string) => {
  const [settings] = await db
    .select({ general: userSettings.general })
    .from(userSettings)
    .where(eq(userSettings.id, userId))
    .limit(1);
  const chosen = (settings?.general as UserGeneralConfig | null | undefined)?.responseLanguage;
  return chosen || (isMainlandRegion(regionEnv.APP_REGION) ? 'zh-CN' : 'en-US');
};
