/**
 * What an audit trail may keep of a tool call, after OpenBot (`server/src/audit.ts`): the shape of
 * the arguments and who they were addressed to, never credentials or the content being sent.
 */
import { approvalKey } from './approval';

/** Credentials, plus fields that carry message or document content rather than its addressing. */
const REDACTED_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'body',
  'clientsecret',
  'content',
  'cookie',
  'credential',
  'credentials',
  'documentcontent',
  'encryptedvalue',
  'html',
  'idtoken',
  'message',
  'passphrase',
  'password',
  'prompt',
  'refreshtoken',
  'result',
  'secret',
  'secrets',
  'text',
  'token',
  'tokens',
  'toolarguments',
  'toolresult',
]);

const MAX_STRING_LENGTH = 300;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 6;

export const REDACTED = '[REDACTED]';

const isRedactedKey = (key: string) =>
  REDACTED_KEYS.has(key.replaceAll(/[^\dA-Z]/gi, '').toLowerCase());

/** A copy of `value` safe to keep: sensitive fields replaced, long strings and lists cut. */
export const redactForAudit = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactForAudit(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...kept, `…${value.length - MAX_ARRAY_ITEMS} more`]
      : kept;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isRedactedKey(key) ? REDACTED : redactForAudit(entry, depth + 1),
    ]),
  );
};

/** Tool arguments arrive as a JSON string; anything else is kept as one opaque value. */
export const parseToolArguments = (args: string | undefined): Record<string, unknown> => {
  if (!args) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { input: parsed };
  } catch {
    return { input: args };
  }
};

/**
 * Identifies one exact call: the same for its approval and its run, different as soon as any
 * argument differs. Uses the approval key, so an audit row can be matched to the approval it
 * released.
 */
export const toolCallDigest = (identifier: string, apiName: string, args: string | undefined) =>
  approvalKey(identifier, apiName, parseToolArguments(args));
