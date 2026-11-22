import type { UserProfileEntry, UserProfileSection } from '@lobechat/types';
import {
  isUserProfileListSection,
  USER_PROFILE_ID_PREFIXES,
  USER_PROFILE_SECTIONS,
} from '@lobechat/types';

/** Longest entry, in characters: a sentence or two, not a document. */
export const PROFILE_TEXT_LIMIT = 500;
/** Most entries a list section holds at once (goals, people, …). */
export const PROFILE_SECTION_LIMIT = 10;
/** Most ids a list section hands out, deleted ones included, so the row stays small. */
export const PROFILE_SECTION_ID_LIMIT = 50;

export type ProfileRefusal =
  'empty' | 'exists' | 'limit' | 'not_found' | 'secret' | 'section' | 'too_long' | 'wrong_section';

export type ProfileOutcome =
  | { entries: UserProfileEntry[]; entry: UserProfileEntry; ok: true }
  | { message: string; ok: false; reason: ProfileRefusal };

export interface SaveEntryInput {
  /** The entry to change; without it a new one is added */
  id?: string;
  section: string;
  text: string;
}

const isSection = (value: string): value is UserProfileSection =>
  (USER_PROFILE_SECTIONS as readonly string[]).includes(value);

export const activeEntries = (entries: UserProfileEntry[]) =>
  entries.filter((entry) => entry.status === 'active');

const refuse = (reason: ProfileRefusal, message: string): ProfileOutcome => ({
  message,
  ok: false,
  reason,
});

/** The next id of a list section: one past the highest ever given, so none is reused. */
const nextId = (entries: UserProfileEntry[], section: keyof typeof USER_PROFILE_ID_PREFIXES) => {
  const prefix = USER_PROFILE_ID_PREFIXES[section];
  const used = entries
    .filter((entry) => entry.section === section)
    .map((entry) => Number(entry.id.slice(prefix.length)))
    .filter(Number.isInteger);
  return `${prefix}${used.length ? Math.max(...used) + 1 : 0}`;
};

const replace = (entries: UserProfileEntry[], entry: UserProfileEntry) =>
  entries.map((existing) => (existing.id === entry.id ? entry : existing));

/**
 * Adds an entry, or changes the one `id` names. A list section's new entry takes the next id; a
 * one-entry section (name, now, ideal, style) is never replaced without its id, so what the user
 * said before is only changed on purpose.
 */
export const saveEntry = (
  entries: UserProfileEntry[],
  { id, section, text: rawText }: SaveEntryInput,
  now: Date,
): ProfileOutcome => {
  if (!isSection(section)) {
    return refuse(
      'section',
      `Unknown section "${section}". Use one of: ${USER_PROFILE_SECTIONS.join(', ')}.`,
    );
  }
  const text = rawText.trim();
  if (!text) return refuse('empty', 'Nothing to save: the text is empty.');
  if ([...text].length > PROFILE_TEXT_LIMIT) {
    return refuse('too_long', `Too long: keep an entry under ${PROFILE_TEXT_LIMIT} characters.`);
  }
  const updatedAt = now.toISOString();

  if (!isUserProfileListSection(section)) {
    const existing = entries.find((entry) => entry.id === section);
    if (existing?.status === 'active' && id !== section) {
      return refuse(
        'exists',
        `"${section}" already says: "${existing.text}". Ask the user before changing it, then call saveEntry again with id "${section}".`,
      );
    }
    if (id && id !== section) {
      return refuse('wrong_section', `The ${section} entry's id is "${section}", not "${id}".`);
    }
    const entry: UserProfileEntry = { id: section, section, status: 'active', text, updatedAt };
    return { entries: existing ? replace(entries, entry) : [...entries, entry], entry, ok: true };
  }

  if (id) {
    const existing = entries.find((entry) => entry.id === id && entry.status === 'active');
    if (!existing) return refuse('not_found', `There is no entry ${id} in the profile.`);
    if (existing.section !== section) {
      return refuse('wrong_section', `${id} is in ${existing.section}, not ${section}.`);
    }
    const entry: UserProfileEntry = { id, section, status: 'active', text, updatedAt };
    return { entries: replace(entries, entry), entry, ok: true };
  }

  const inSection = entries.filter((entry) => entry.section === section);
  if (
    activeEntries(inSection).length >= PROFILE_SECTION_LIMIT ||
    inSection.length >= PROFILE_SECTION_ID_LIMIT
  ) {
    return refuse(
      'limit',
      `${section} is full. Ask the user which entry to change or delete first.`,
    );
  }
  const entry: UserProfileEntry = {
    id: nextId(entries, section),
    section,
    status: 'active',
    text,
    updatedAt,
  };
  return { entries: [...entries, entry], entry, ok: true };
};

/** Deletes an entry: its id stays, marked deleted, and its text goes. */
export const dropEntry = (entries: UserProfileEntry[], id: string, now: Date): ProfileOutcome => {
  const existing = entries.find((entry) => entry.id === id && entry.status === 'active');
  if (!existing) return refuse('not_found', `There is no entry ${id} in the profile.`);
  const entry: UserProfileEntry = {
    id,
    section: existing.section,
    status: 'dropped',
    text: '',
    updatedAt: now.toISOString(),
  };
  return { entries: replace(entries, entry), entry, ok: true };
};

/** Marks entries the user says still hold, without changing them. */
export const confirmEntries = (entries: UserProfileEntry[], ids: string[], now: Date) => {
  const wanted = new Set(ids);
  const reviewedAt = now.toISOString();
  const confirmed: string[] = [];
  const next = entries.map((entry) => {
    if (entry.status !== 'active' || !wanted.has(entry.id)) return entry;
    confirmed.push(entry.id);
    return { ...entry, reviewedAt };
  });
  return { confirmed, entries: next, unknown: ids.filter((id) => !confirmed.includes(id)) };
};
