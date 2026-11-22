import type { UserProfileEntry, UserProfileSection } from '@lobechat/types';
import { USER_PROFILE_SECTIONS } from '@lobechat/types';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    userProfileInjected?: boolean;
  }
}

const log = debug('context-engine:provider:UserProfileInjector');

export interface UserProfileInjectorConfig {
  /** The user's profile entries; deleted ones are left out */
  entries?: UserProfileEntry[];
}

const SECTION_TITLES: Record<UserProfileSection, string> = {
  challenges: 'Challenges',
  goals: 'Goals',
  ideal: 'Where they want to be in a year',
  mission: 'Mission',
  name: 'What to call them',
  now: 'Where things stand now',
  people: 'People who matter to them',
  projects: 'Projects',
  style: 'How they want you to talk to them',
};

/** The user's own words never close the block they sit in. */
const inert = (text: string) => text.replaceAll(/<\/?user_profile\b[^>]*>/gi, '');

const asOf = (entry: UserProfileEntry) => {
  const latest = [entry.updatedAt, entry.reviewedAt].filter(Boolean).sort().at(-1);
  return latest ? latest.slice(0, 10) : undefined;
};

/**
 * The user's profile as Biber reads it on every turn, shaped after LifeOS's PRINCIPAL_TELOS: one
 * heading per section, each entry with the id the profile tools take and the date it was last
 * true, so Biber can tell what may be out of date.
 */
export const formatUserProfile = (entries: UserProfileEntry[]): string | null => {
  const active = entries.filter((entry) => entry.status === 'active' && entry.text.trim());
  if (!active.length) return null;

  const sections = USER_PROFILE_SECTIONS.flatMap((section) => {
    const lines = active
      .filter((entry) => entry.section === section)
      .map((entry) => {
        const date = asOf(entry);
        return `- [${entry.id}] ${inert(entry.text.trim())}${date ? ` (as of ${date})` : ''}`;
      });
    return lines.length ? [`## ${SECTION_TITLES[section]}\n${lines.join('\n')}`] : [];
  });

  return [
    '<user_profile>',
    'What the user told you about themselves, in their own words. The ids in brackets are for the profile tools.',
    '',
    sections.join('\n\n'),
    '</user_profile>',
  ].join('\n');
};

/**
 * User Profile Injector
 * Puts what the user told Biber about themselves before the first user message
 */
export class UserProfileInjector extends BaseFirstUserContentProvider {
  readonly name = 'UserProfileInjector';

  constructor(
    private config: UserProfileInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    const content = formatUserProfile(this.config.entries ?? []);
    log(content ? 'User profile prepared' : 'No user profile to inject');
    return content;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);
    if (formatUserProfile(this.config.entries ?? [])) result.metadata.userProfileInjected = true;
    return result;
  }
}
