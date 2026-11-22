import { ProfileIdentifier } from '@lobechat/builtin-tool-profile';

import { profileToolActions } from '@/server/services/userProfile/tool';

import { type ServerRuntimeRegistration } from './types';

/** The profile tool wherever the server runs tools: phone chat, chat apps, tasks, the gateway. */
export const profileRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Profile tool execution');
    }
    return profileToolActions(context.serverDB, context.userId);
  },
  identifier: ProfileIdentifier,
};
