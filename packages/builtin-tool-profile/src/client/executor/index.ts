import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { profileService } from '@/services/profile';

import { ProfileIdentifier } from '../../manifest';
import type { ConfirmEntriesParams, DropEntryParams, SaveEntryParams } from '../../types';
import { ProfileApiName } from '../../types';

/**
 * Runs the profile tool from the browser when the web chat executes tools there. Every call goes
 * to the server, which answers the same as it does when it runs the tool itself.
 */
class ProfileExecutor extends BaseExecutor<typeof ProfileApiName> {
  readonly identifier = ProfileIdentifier;
  protected readonly apiEnum = ProfileApiName;

  private run = async (call: () => Promise<BuiltinToolResult>): Promise<BuiltinToolResult> => {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'ProfileRequestFailed' },
        success: false,
      };
    }
  };

  confirmEntries = (params: ConfirmEntriesParams) =>
    this.run(() => profileService.confirmEntries(params));

  dropEntry = (params: DropEntryParams) => this.run(() => profileService.dropEntry(params));

  finishInterview = () => this.run(() => profileService.finishInterview());

  saveEntry = (params: SaveEntryParams) => this.run(() => profileService.saveEntry(params));
}

export const profileExecutor = new ProfileExecutor();
