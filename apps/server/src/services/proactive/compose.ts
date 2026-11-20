import debug from 'debug';

import type { ProactiveThoughtItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { SystemAgentService } from '@/server/services/systemAgent';

const log = debug('lobe-server:proactive:compose');

/** A proactive message reads like a chat message: short. */
const CONTENT_LIMIT = 300;

export const PROACTIVE_MESSAGE_SCHEMA_NAME = 'proactive_message';

/** Every field is required so the schema works in strict mode; skipping leaves the rest empty. */
export const PROACTIVE_MESSAGE_SCHEMA = {
  additionalProperties: false,
  properties: {
    content: { type: 'string' },
    reason: { type: 'string' },
    skip: { type: 'boolean' },
    thoughtId: { type: 'string' },
  },
  required: ['skip', 'thoughtId', 'content', 'reason'],
  type: 'object' as const,
};

export type ComposeResult = { content: string; skip: false; thoughtId: string } | { skip: true };

export interface ComposeInput {
  candidates: ProactiveThoughtItem[];
  /** The user's language, e.g. `zh-CN` */
  locale: string;
  now: Date;
  /** What Biber said unprompted lately, newest first, so it does not repeat itself */
  recent: string[];
  timeZone: string;
}

const SYSTEM_PROMPT = `You are Biber, the user's personal assistant. You are about to send the user one short message they did not ask for.

Only write about one of the items listed below, and only if it is worth their attention now. Otherwise skip: skipping is normal and often right.

Rules:
- One or two sentences, like a message from a thoughtful assistant. No greeting, no sign-off.
- A reminder says what is coming and when, plus one useful nudge if there is an obvious one.
- A follow-up asks how it went, briefly, and offers help only if it fits.
- Use only what the item says. Do not invent times, places or people.
- Do not mention memory, notes, or how you know. Do not repeat or rephrase a recent message.
- Write in the language of the locale you are given.

Answer as JSON: {"skip": false, "thoughtId": "<the item's id>", "content": "<the message>", "reason": ""}, or {"skip": true, "thoughtId": "", "content": "", "reason": "<why>"}.`;

const describeWhen = (when: Date | null, { locale, timeZone }: ComposeInput) =>
  when
    ? new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        timeZone,
        weekday: 'short',
      }).format(when)
    : 'unknown';

/** The user's half of the prompt: the moment, the items to choose from, and what was said lately. */
export const buildComposePrompt = (input: ComposeInput) => {
  const items = input.candidates.map((thought) =>
    [
      `- id: ${thought.id}`,
      `  kind: ${thought.kind === 'reminder' ? 'reminder (coming up)' : 'follow-up (ask how it went)'}`,
      `  when: ${describeWhen(thought.occursAt, input)}`,
      `  about: ${thought.seed}`,
    ].join('\n'),
  );

  return [
    `Locale: ${input.locale}`,
    `Now: ${describeWhen(input.now, input)} (${input.timeZone})`,
    '',
    'Items:',
    ...items,
    '',
    'Recent messages you sent (do not repeat):',
    ...(input.recent.length > 0 ? input.recent.map((text) => `- ${text}`) : ['- none']),
  ].join('\n');
};

/** Keeps a reply only when it names an offered item and says something, cut to chat length. */
export const readComposeReply = (
  reply: { content?: string; skip?: boolean; thoughtId?: string },
  candidates: Pick<ProactiveThoughtItem, 'id'>[],
): ComposeResult => {
  const content = reply.content?.trim() ?? '';
  if (reply.skip !== false || !content) return { skip: true };
  if (!candidates.some((thought) => thought.id === reply.thoughtId)) return { skip: true };

  return {
    content: content.length > CONTENT_LIMIT ? `${content.slice(0, CONTENT_LIMIT - 1)}…` : content,
    skip: false,
    thoughtId: reply.thoughtId!,
  };
};

/**
 * Asks the model, as the system assistant set up for topic work, to write one unprompted message
 * about one of the candidates, or to skip. A failed call counts as a skip.
 */
export const composeProactiveMessage = async (
  db: LobeChatDatabase,
  userId: string,
  input: ComposeInput,
): Promise<ComposeResult> => {
  try {
    const systemAgent = new SystemAgentService(db, userId);
    const { model, provider } = await (systemAgent as any).getTaskModelConfig('topic');
    const runtime = await initModelRuntimeFromDB(db, userId, provider);

    const reply = (await runtime.generateObject(
      {
        messages: [
          { content: SYSTEM_PROMPT, role: 'system' },
          { content: buildComposePrompt(input), role: 'user' },
        ] as any[],
        model,
        schema: { name: PROACTIVE_MESSAGE_SCHEMA_NAME, schema: PROACTIVE_MESSAGE_SCHEMA },
      },
      { metadata: { trigger: 'proactive_message' } },
    )) as { content?: string; reason?: string; skip?: boolean; thoughtId?: string };

    if (reply.skip) log('model skipped for userId=%s: %s', userId, reply.reason);
    return readComposeReply(reply, input.candidates);
  } catch (error) {
    log('compose failed for userId=%s: %O', userId, error);
    return { skip: true };
  }
};
