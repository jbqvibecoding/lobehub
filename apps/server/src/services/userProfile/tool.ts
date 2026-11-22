import type {
  ConfirmEntriesParams,
  DropEntryParams,
  SaveEntryParams,
} from '@lobechat/builtin-tool-profile';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';

import type { ProfileOutcome } from './entries';
import { UserProfileService } from './index';

const failure = (type: string, message: string): BuiltinServerRuntimeOutput => ({
  content: message,
  error: { message, type },
  success: false,
});

const refused = (outcome: Extract<ProfileOutcome, { ok: false }>) =>
  failure(`Profile_${outcome.reason}`, outcome.message);

/**
 * What Biber's profile tool answers, the same wherever it runs: the server runtime (phone, chat
 * apps, tasks) and the web chat's browser, through the lambda router.
 */
export const profileToolActions = (db: LobeChatDatabase, userId: string) => {
  const profile = new UserProfileService(db, userId);

  return {
    confirmEntries: async ({ ids }: ConfirmEntriesParams): Promise<BuiltinServerRuntimeOutput> => {
      const { confirmed, unknown } = await profile.confirmEntries(ids ?? []);
      if (!confirmed.length) {
        return failure(
          'Profile_not_found',
          `There is no entry ${unknown.join(', ')} in the profile.`,
        );
      }
      const missing = unknown.length ? ` There is no ${unknown.join(', ')}.` : '';
      return {
        content: `Confirmed ${confirmed.join(', ')} as still holding.${missing}`,
        state: { confirmed },
        success: true,
      };
    },

    dropEntry: async ({ id }: DropEntryParams): Promise<BuiltinServerRuntimeOutput> => {
      const outcome = await profile.dropEntry(id);
      if (!outcome.ok) return refused(outcome);
      return { content: `Deleted ${id}.`, state: { entry: outcome.entry }, success: true };
    },

    saveEntry: async (params: SaveEntryParams): Promise<BuiltinServerRuntimeOutput> => {
      const outcome = await profile.saveEntry(params);
      if (!outcome.ok) return refused(outcome);
      const { entry } = outcome;
      return {
        content: `Saved ${entry.id} (${entry.section}): "${entry.text}".`,
        state: { entry },
        success: true,
      };
    },
  };
};
