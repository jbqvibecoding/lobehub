import type {
  ConfirmEntriesParams,
  DropEntryParams,
  SaveEntryParams,
} from '@lobechat/builtin-tool-profile';

import { lambdaClient } from '@/libs/trpc/client';

/** The user's profile from the web chat's browser: the server keeps it and does the work. */
export const profileService = {
  confirmEntries: (params: ConfirmEntriesParams) =>
    lambdaClient.profile.confirmEntries.mutate(params),

  dropEntry: (params: DropEntryParams) => lambdaClient.profile.dropEntry.mutate(params),

  get: () => lambdaClient.profile.get.query(),

  saveEntry: (params: SaveEntryParams) => lambdaClient.profile.saveEntry.mutate(params),
};
