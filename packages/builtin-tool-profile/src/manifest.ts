import type { BuiltinToolManifest } from '@lobechat/types';
import { USER_PROFILE_SECTIONS } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ProfileApiName } from './types';

export const ProfileIdentifier = 'lobe-profile';

const ID = {
  description: 'An entry id from the profile, such as G0 or now',
  type: 'string',
} as const;

export const ProfileManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Keep something the user told you about themselves in their profile, or change an entry by its id. Only what the user said and wants kept, never a guess or a secret.',
      name: ProfileApiName.saveEntry,
      parameters: {
        additionalProperties: false,
        properties: {
          id: {
            ...ID,
            description:
              'The entry to change, as the profile shows it (G0, PE1, now…). Leave it out to add a new entry.',
          },
          section: {
            description:
              'name: what to call them. mission: what they are about. goals: what they want to achieve, with a date if they gave one. challenges: what stands in their way. projects: what they are working on. people: someone who matters to them, with who they are. now: where things stand. ideal: where they want to be in a year. style: how they want you to talk to them.',
            enum: [...USER_PROFILE_SECTIONS],
            type: 'string',
          },
          text: {
            description:
              'In the user’s words and language, briefly, e.g. "Run a full marathon before October". At most 500 characters.',
            maxLength: 500,
            type: 'string',
          },
        },
        required: ['section', 'text'],
        type: 'object',
      },
    },
    {
      description:
        'Delete an entry the user says is no longer true or asks you to remove. Its number is not reused.',
      name: ProfileApiName.dropEntry,
      parameters: {
        additionalProperties: false,
        properties: { id: ID },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'In the "About you" interview only: mark it finished, once you have listed what you saved and told the user where to change it.',
      name: ProfileApiName.finishInterview,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description: 'Mark entries the user says still hold as they are, without changing them.',
      name: ProfileApiName.confirmEntries,
      parameters: {
        additionalProperties: false,
        properties: { ids: { items: ID, maxItems: 50, type: 'array' } },
        required: ['ids'],
        type: 'object',
      },
    },
  ],
  identifier: ProfileIdentifier,
  meta: {
    avatar: '🪪',
    description: 'What the user told Biber about themselves',
    title: 'About you',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
