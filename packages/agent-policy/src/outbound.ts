/**
 * Secrets in what a tool call would send out, after openduet's outgoing check: a password, a key,
 * a card or an identity number in the arguments of a call to a third-party service. Such a call
 * waits for the owner even when its tool is always allowed, since a prompt-injected agent leaks
 * secrets exactly this way; and wherever the arguments are shown or kept, the values are masked.
 *
 * Patterns are chosen to rarely fire on ordinary text: key formats with their issuers' prefixes,
 * card numbers with an issuer prefix and a valid Luhn check digit, identity numbers with a valid
 * check digit or date.
 */
export type SecretKind = 'api_key' | 'card_number' | 'id_number' | 'password' | 'private_key';

export const REDACTED = '[REDACTED]';

const luhnValid = (digits: string) => {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

/** Visa, Mastercard, American Express, UnionPay, Discover, JCB. */
const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[47]|35|6)/;

const isCardNumber = (match: string) => {
  const digits = match.replaceAll(/\D/g, '');
  return (
    digits.length >= 13 && digits.length <= 19 && CARD_PREFIX.test(digits) && luhnValid(digits)
  );
};

const CHINA_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHINA_ID_CHECK = '10X98765432';

/** A mainland resident identity number: a real date of birth and the right check character. */
const isChinaId = (match: string) => {
  const id = match.toUpperCase();
  const year = Number(id.slice(6, 10));
  const month = Number(id.slice(10, 12));
  const day = Number(id.slice(12, 14));
  const born = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    born.getUTCMonth() !== month - 1 ||
    born.getUTCDate() !== day ||
    born.getTime() > Date.now()
  ) {
    return false;
  }
  const sum = CHINA_ID_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(id[index]),
    0,
  );
  return CHINA_ID_CHECK[sum % 11] === id[17];
};

interface Detector {
  kind: SecretKind;
  pattern: RegExp;
  valid?: (match: string) => boolean;
}

/** In order: identity numbers before card numbers, so an ID is not also read as a card. */
const DETECTORS: Detector[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  {
    kind: 'api_key',
    // OpenAI, Anthropic, Stripe, GitHub, GitLab, Slack, AWS, Google
    pattern:
      /\b(?:sk-[\w-]{20,}|[rs]k_live_\w{16,}|gh[oprsu]_\w{30,}|github_pat_\w{40,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|AKIA[\dA-Z]{16}|AIza[\w-]{35})/g,
  },
  { kind: 'api_key', pattern: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g },
  {
    kind: 'password',
    pattern:
      /(?:password|passwd|passcode|pwd|密码|口令)\s*(?:is|was|[=:：是为])\s*["'“]?[^\s"'”，。,]{3,}/giu,
  },
  { kind: 'id_number', pattern: /(?<!\d)[1-8]\d{16}[\dX](?![\dA-Z])/gi, valid: isChinaId },
  // A US Social Security number, written with its dashes
  { kind: 'id_number', pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { kind: 'card_number', pattern: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, valid: isCardNumber },
];

/** Field names whose value is a secret whatever it looks like. */
const SECRET_FIELDS: Record<string, SecretKind> = {
  accesstoken: 'api_key',
  apikey: 'api_key',
  apisecret: 'api_key',
  clientsecret: 'api_key',
  passcode: 'password',
  passphrase: 'password',
  passwd: 'password',
  password: 'password',
  privatekey: 'private_key',
  pwd: 'password',
  refreshtoken: 'api_key',
  secretkey: 'api_key',
};

const fieldKind = (key: string) => SECRET_FIELDS[key.replaceAll(/[^\dA-Z]/gi, '').toLowerCase()];

const MAX_DEPTH = 8;

/** Runs every detector over `text`, replacing what each finds so later ones do not see it again. */
const scanText = (text: string, found: Set<SecretKind>): string => {
  let rest = text;
  for (const { kind, pattern, valid } of DETECTORS) {
    rest = rest.replaceAll(pattern, (match) => {
      if (valid && !valid(match)) return match;
      found.add(kind);
      return REDACTED;
    });
  }
  return rest;
};

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const walk = (value: unknown, found: Set<SecretKind>, depth: number): unknown => {
  if (typeof value === 'string') return scanText(value, found);
  if (!value || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, found, depth + 1));
  // Dates and other class instances carry no text to scan and must keep their type
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const kind = fieldKind(key);
      if (kind && typeof entry === 'string' && entry.trim()) {
        found.add(kind);
        return [key, REDACTED];
      }
      return [key, walk(entry, found, depth + 1)];
    }),
  );
};

/** The kinds of secrets in a tool call's arguments, in a stable order; empty when there are none. */
export const findSecrets = (args: unknown): SecretKind[] => {
  const found = new Set<SecretKind>();
  walk(args, found, 0);
  return [...found].sort();
};

/** A copy of `value` with every secret replaced by `REDACTED`. */
export const maskSecrets = <T>(value: T): T => walk(value, new Set(), 0) as T;
