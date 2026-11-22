import type { UserProfileSection } from '@lobechat/types';

export const ProfileApiName = {
  /** Mark entries the user says still hold */
  confirmEntries: 'confirmEntries',

  /** Delete an entry the user wants gone */
  dropEntry: 'dropEntry',

  /** Add an entry, or change one by its id */
  saveEntry: 'saveEntry',
} as const;

export type ProfileApiNameType = (typeof ProfileApiName)[keyof typeof ProfileApiName];

export interface SaveEntryParams {
  id?: string;
  section: UserProfileSection;
  text: string;
}

export interface DropEntryParams {
  id: string;
}

export interface ConfirmEntriesParams {
  ids: string[];
}
