import { createHash, randomUUID } from 'node:crypto';

import type { ModelRuntimeHooks } from '@lobechat/model-runtime';
import { isMainlandRegion } from '@lobechat/region';
import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';

import { contentSafetyEnv } from '@/envs/contentSafety';
import { regionEnv } from '@/envs/region';
import { signAliyunRequest } from '@/server/services/sms/aliyun';

const log = debug('lobe-server:content-safety');

/**
 * Content safety for the mainland edition (decision 11), with Alibaba Cloud Content Moderation's
 * Text Moderation Plus: what a user asks is checked before it reaches a model, and a model's reply
 * is checked once it is complete. A check that cannot be made counts as flagged, unless the
 * deployment sets `CONTENT_SAFETY_ON_ERROR=allow`.
 */
export const DEFAULT_ALIYUN_GREEN_ENDPOINT = 'https://green-cip.cn-shanghai.aliyuncs.com';
/** Text Moderation Plus takes at most this many characters per check. */
const MAX_CHARS_PER_CHECK = 2000;
/** Longer text is checked in this many pieces at most; past that, the start and the end. */
const MAX_CHECKS = 5;

/** What a reply that failed the check becomes, in the store and in chats. */
export const REPLY_HIDDEN_NOTICE = '这条回复未通过内容安全审核，已隐藏。';
/** What an earlier message that failed the check becomes before the history goes to a model. */
export const INPUT_WITHHELD_PLACEHOLDER = '（这条消息未通过内容安全审核，没有发给模型）';

/** How many of the latest user messages each model call checks. */
const USER_MESSAGES_CHECKED = 20;
/** Verdicts kept per process, so a message in the history is checked once rather than per call. */
const VERDICT_CACHE_SIZE = 5000;
const inputVerdicts = new Map<string, boolean>();

type ModerationService = 'llm_query_moderation' | 'llm_response_moderation';

export interface ModerationVerdict {
  flagged: boolean;
  labels: string[];
}

/** Content safety runs in the mainland edition once its AccessKey is configured. */
export const isContentSafetyEnabled = () =>
  isMainlandRegion(regionEnv.APP_REGION) &&
  !!contentSafetyEnv.ALIYUN_GREEN_ACCESS_KEY_ID &&
  !!contentSafetyEnv.ALIYUN_GREEN_ACCESS_KEY_SECRET;

const failClosed = () => contentSafetyEnv.CONTENT_SAFETY_ON_ERROR !== 'allow';

const pieces = (text: string) => {
  const all: string[] = [];
  for (let start = 0; start < text.length; start += MAX_CHARS_PER_CHECK) {
    all.push(text.slice(start, start + MAX_CHARS_PER_CHECK));
  }
  if (all.length <= MAX_CHECKS) return all;
  return [...all.slice(0, MAX_CHECKS - 1), all.at(-1)!];
};

const checkPiece = async (
  service: ModerationService,
  content: string,
): Promise<ModerationVerdict> => {
  const { headers, url } = signAliyunRequest({
    accessKeyId: contentSafetyEnv.ALIYUN_GREEN_ACCESS_KEY_ID!,
    accessKeySecret: contentSafetyEnv.ALIYUN_GREEN_ACCESS_KEY_SECRET!,
    action: 'TextModerationPlus',
    date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endpoint: contentSafetyEnv.ALIYUN_GREEN_ENDPOINT ?? DEFAULT_ALIYUN_GREEN_ENDPOINT,
    nonce: randomUUID(),
    query: { Service: service, ServiceParameters: JSON.stringify({ content }) },
    version: '2022-03-02',
  });

  const response = await fetch(url, { headers, method: 'POST' });
  const data = (await response.json().catch(() => ({}))) as {
    Code?: number;
    Data?: { Result?: { Label?: string }[]; RiskLevel?: string };
    Message?: string;
  };
  if (!response.ok || data.Code !== 200) {
    throw new Error(
      `Aliyun moderation failed: ${data.Code ?? response.status} ${data.Message ?? ''}`.trim(),
    );
  }

  return {
    flagged: data.Data?.RiskLevel === 'high',
    labels: (data.Data?.Result ?? [])
      .map((result) => result.Label)
      .filter((label): label is string => !!label && label !== 'nonLabel'),
  };
};

/** Checks text with one moderation service; long text is checked in pieces. */
export const moderateText = async (
  service: ModerationService,
  text: string,
): Promise<ModerationVerdict> => {
  const verdicts = await Promise.all(pieces(text).map((piece) => checkPiece(service, piece)));
  return {
    flagged: verdicts.some((verdict) => verdict.flagged),
    labels: [...new Set(verdicts.flatMap((verdict) => verdict.labels))],
  };
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
    .join('\n');
};

const refused = (message: string, labels: string[] = []) => ({
  error: { labels, message },
  errorType: AgentRuntimeErrorType.ContentModeration,
});

/** The refusal's message when `error` is one this module threw; undefined for any other error. */
export const refusalMessageOf = (error: unknown): string | undefined => {
  const refusal = error as Partial<ReturnType<typeof refused>> | null;
  return refusal?.errorType === AgentRuntimeErrorType.ContentModeration
    ? refusal.error?.message
    : undefined;
};

const isInputFlagged = async (text: string) => {
  const key = createHash('sha256').update(text).digest('hex');
  const cached = inputVerdicts.get(key);
  if (cached !== undefined) return cached;

  const verdict = await moderateText('llm_query_moderation', text);
  if (verdict.flagged) log('input flagged as %o', verdict.labels);
  if (inputVerdicts.size >= VERDICT_CACHE_SIZE) {
    inputVerdicts.delete(inputVerdicts.keys().next().value!);
  }
  inputVerdicts.set(key, verdict.flagged);
  return verdict.flagged;
};

/**
 * Checks the user's words in a model call before it is sent. The call is refused when the latest
 * user message is flagged. An earlier message that was flagged (refused when it
 * was sent, and still in the history) is replaced in the outgoing messages, so it never reaches a
 * model in a later turn. Verdicts are cached, so each message is checked once per process.
 */
export const assertUserInputAllowed = async (messages: { content: unknown; role: string }[]) => {
  if (!isContentSafetyEnabled()) return;

  const userMessages = messages
    .filter((message) => message.role === 'user' && textOf(message.content).trim())
    .slice(-USER_MESSAGES_CHECKED);
  if (userMessages.length === 0) return;

  let flagged: boolean[];
  try {
    flagged = await Promise.all(
      userMessages.map((message) => isInputFlagged(textOf(message.content).trim())),
    );
  } catch (error) {
    if (!failClosed()) {
      console.error('[content-safety] input check failed, letting it through: %O', error);
      return;
    }
    console.error('[content-safety] input check failed, refusing the request: %O', error);
    throw refused('The content check is unavailable right now');
  }

  // The latest user message is what this turn asks about, whatever follows it in the call (the
  // reply being written, tool results). A flagged one is refused on the turn's first call, so no
  // later step of that turn ever carries it.
  if (flagged.at(-1)) {
    log('refused: the latest user message is flagged');
    throw refused('The request was refused by content safety');
  }
  userMessages.forEach((message, index) => {
    if (flagged[index]) message.content = INPUT_WITHHELD_PLACEHOLDER;
  });
};

/**
 * Whether a complete model reply may be shown. `hidden` when the check flags it, or when the check
 * cannot be made and the deployment fails closed.
 */
export const reviewModelReply = async (text: string): Promise<'allowed' | 'hidden'> => {
  if (!isContentSafetyEnabled() || !text.trim()) return 'allowed';

  try {
    const verdict = await moderateText('llm_response_moderation', text);
    if (verdict.flagged) log('reply flagged as %o', verdict.labels);
    return verdict.flagged ? 'hidden' : 'allowed';
  } catch (error) {
    console.error('[content-safety] reply check failed: %O', error);
    return failClosed() ? 'hidden' : 'allowed';
  }
};

/** The model-runtime hook that checks user input before every call; none outside mainland. */
export const contentSafetyHooks = (): ModelRuntimeHooks | undefined =>
  isContentSafetyEnabled()
    ? { beforeChat: (payload) => assertUserInputAllowed(payload.messages as any[]) }
    : undefined;
