/**
 * Secrets in what the agent reads from the user's mailbox: one-time codes, temporary passwords,
 * and links that sign in, reset a password or confirm an address. They are replaced before a mail
 * reaches the model, so a prompt-injected agent cannot pass them on; the user reads them in the
 * mail itself. Like the outgoing check (`outbound.ts`), patterns are kept narrow: a code counts only
 * next to the words that announce one, and a link only when it both says what it is for and
 * carries a token, so order numbers, phone numbers, dates and ordinary links stay readable.
 */

export const HIDDEN = '[hidden]';

/** Words that announce a one-time code, in Chinese and English. */
const CODE_WORDS =
  /验证码|校验码|动态码|动态密码|确认码|安全码|登录码|授权码|激活码|短信码|一次性密码|verification code|security code|confirmation code|log-?in code|sign-?in code|one[ -]time (?:code|pass(?:word|code))|access code|authentication code|auth code|passcode|2fa code|two-factor code|\botp\b/i;

/** "code is 123456", "code: 123456" right before the code. */
const CODE_IS_BEFORE = /\bcode\s*(?:is|:|：)\s*$/i;
/** "123456 is your … code" right after the code. */
const IS_CODE_AFTER = /^\s*is your\b[^\n]{1,30}?\bcode\b/i;

/**
 * A code: 4–8 digits, digits in two groups ("482 913", "55-1208"), or 5–8 capitals mixed with
 * digits ("G7K2Q9"). Never part of a longer word or number.
 */
const CODE_TOKEN =
  /(?<![\w-])(?:\d{2,4}[ -]\d{2,4}|\d{4,8}|(?=[\dA-Z]*\d)(?=[\dA-Z]*[A-Z])[\dA-Z]{5,8})(?![\w-])/g;

const WINDOW = 40;

/** A temporary or new password given in the mail, and the password itself. */
const GIVEN_PASSWORD =
  /((?:temporary|initial|new|one-time) password|临时密码|初始密码|新密码)(\s*(?:(?:is|[为是:：])\s*)?)([^\s，。,;；]{6,32})/gi;

const URL = /https?:\/\/[^\s"'<>`()（）[\]【】，。、]+/gi;
/** What the link is for, read from its path and query. */
const LINK_PURPOSE =
  /reset|password|passwd|verif|confirm|magic|log-?in|sign-?in|sign_in|auth|activat|one-?time|otp|invite|unlock|recover/i;
const TOKEN_PARAM =
  /[#&?](?:token|code|key|otp|ticket|sig|signature|hash|auth|nonce|secret|t|k)=[^#&]{8,}/i;
/** A long segment of letters and digits, as tokens are. */
const LONG_RANDOM = /[\w-]{16,}/g;

const isRandom = (segment: string) => /\d/.test(segment) && /[A-Z]/i.test(segment);

const isSecretLink = (url: string) => {
  const rest = url.replace(/^https?:\/\/[^#/?]+/i, '');
  if (!LINK_PURPOSE.test(rest)) return false;
  return TOKEN_PARAM.test(rest) || (rest.match(LONG_RANDOM) ?? []).some(isRandom);
};

const isAnnouncedCode = (text: string, start: number, end: number) => {
  const before = text.slice(Math.max(0, start - WINDOW), start);
  const after = text.slice(end, end + WINDOW);
  return (
    CODE_WORDS.test(before) ||
    CODE_WORDS.test(after) ||
    CODE_IS_BEFORE.test(before) ||
    IS_CODE_AFTER.test(after)
  );
};

/** `text` with one-time codes, given passwords and secret links replaced by `HIDDEN`. */
export const maskMailSecrets = (text: string): string => {
  if (!text) return text;

  const withoutLinks = text
    .replaceAll(URL, (url) => (isSecretLink(url) ? HIDDEN : url))
    .replaceAll(GIVEN_PASSWORD, (_match, label, joiner) => `${label}${joiner}${HIDDEN}`);

  return withoutLinks.replaceAll(CODE_TOKEN, (token, offset: number, whole: string) =>
    isAnnouncedCode(whole, offset, offset + token.length) ? HIDDEN : token,
  );
};

const MAX_DEPTH = 10;

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const walk = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') return maskMailSecrets(value);
  if (!value || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, walk(entry, depth + 1)]),
  );
};

/** A copy of a mail tool's result, of any shape, with every string passed through `maskMailSecrets`. */
export const maskMailSecretsIn = <T>(value: T): T => walk(value, 0) as T;
