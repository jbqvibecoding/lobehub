/**
 * The tools that act on the user's own mailbox and calendar, from Composio or Biber's own. They act
 * in the user's name, so every change waits for the user, not only sending and deleting; what they
 * read is masked before the model sees it (`maskMailSecrets`).
 */
import { READ_WORDS, SENSITIVE_WORDS, words } from './toolClass';

/** Mailbox toolkits: Composio's Gmail and Outlook (mail and calendar), and Biber's own. */
export const MAIL_TOOLKITS = new Set(['gmail', 'lobe-mail', 'outlook-mail']);
export const CALENDAR_TOOLKITS = new Set(['google-calendar', 'lobe-calendar']);

export const isMailToolkit = (identifier: string) => MAIL_TOOLKITS.has(identifier);
export const isPersonalAccountToolkit = (identifier: string) =>
  MAIL_TOOLKITS.has(identifier) || CALENDAR_TOOLKITS.has(identifier);

/**
 * Composio names an action after its toolkit first (`GMAIL_FETCH_EMAILS`,
 * `OUTLOOK_OUTLOOK_LIST_MESSAGES`); what it does follows.
 */
export const stripToolkitPrefix = (name: string) =>
  name.replace(/^(?:(?:gmail|googlecalendar|outlook)_)+/i, '');

/** Words that change a mailbox or a calendar, beyond the sensitive ones every tool asks for. */
const CHANGE_WORDS = new Set([
  'accept',
  'add',
  'apply',
  'archive',
  'batch',
  'clear',
  'copy',
  'create',
  'decline',
  'draft',
  'edit',
  'forward',
  'import',
  'insert',
  'label',
  'mark',
  'modify',
  'move',
  'patch',
  'post',
  'put',
  'quick',
  'rename',
  'reply',
  'respond',
  'set',
  'star',
  'trash',
  'update',
  'upload',
]);

/**
 * Whether a mailbox or calendar action only reads: it says it reads (`list`, `get`, `find` …
 * anywhere in its name, since `EVENTS_LIST` reads too) and says nothing that changes. Anything
 * unclear counts as a change, so it asks.
 */
export const isReadOnlyAccountAction = (name: string) => {
  const parts = words(stripToolkitPrefix(name));
  if (parts.some((part) => SENSITIVE_WORDS.has(part) || CHANGE_WORDS.has(part))) return false;
  return parts.some((part) => READ_WORDS.has(part));
};

/**
 * Biber's own calls that carry the user's words to other people: mail, invitations, and what it
 * types into a web page or puts in an address on its cloud computer.
 */
export const BUILTIN_OUTBOUND_CALLS = new Set([
  'lobe-calendar/createEvent',
  'lobe-calendar/updateEvent',
  'lobe-computer/navigate',
  'lobe-computer/type',
  'lobe-mail/sendMail',
]);
