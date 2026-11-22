/**
 * What the user told Biber about themselves, mostly in the onboarding interview. The sections and
 * the numbering follow LifeOS's TELOS file (MIT, Daniel Miessler): an entry keeps its id for good
 * (G3 stays G3), and a deleted one leaves a record that it was deleted, never its text.
 */
export const USER_PROFILE_SECTIONS = [
  'name',
  'mission',
  'goals',
  'challenges',
  'projects',
  'people',
  'now',
  'ideal',
  'style',
] as const;

export type UserProfileSection = (typeof USER_PROFILE_SECTIONS)[number];

/** Sections that hold numbered entries, and the prefix of their ids (G0, G1, …). */
export const USER_PROFILE_ID_PREFIXES = {
  challenges: 'C',
  goals: 'G',
  mission: 'M',
  people: 'PE',
  projects: 'PR',
} as const satisfies Partial<Record<UserProfileSection, string>>;

export type UserProfileListSection = keyof typeof USER_PROFILE_ID_PREFIXES;

/** The other sections hold one entry, whose id is the section's own name. */
export type UserProfileSingleSection = Exclude<UserProfileSection, UserProfileListSection>;

export const isUserProfileListSection = (
  section: UserProfileSection,
): section is UserProfileListSection => section in USER_PROFILE_ID_PREFIXES;

export interface UserProfileEntry {
  id: string;
  /** When the user last said it still holds, without changing it */
  reviewedAt?: string;
  section: UserProfileSection;
  /** `dropped` entries keep their id and lose their text */
  status: 'active' | 'dropped';
  text: string;
  updatedAt: string;
}

export interface UserProfileInterview {
  finishedAt?: string;
  /** The user tapped "Later" on the invite; it is not shown again */
  inviteDismissed?: boolean;
  startedAt?: string;
  /** The conversation the interview runs in */
  topicId?: string;
}
