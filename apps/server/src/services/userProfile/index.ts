import type { UserProfileEntry, UserProfileInterview } from '@lobechat/types';
import debug from 'debug';

import { UserProfileModel } from '@/database/models/userProfile';
import type { LobeChatDatabase } from '@/database/type';
import { holdsSecret } from '@/server/services/memory/userMemory/secretGuard';

import type { ProfileOutcome, SaveEntryInput } from './entries';
import { activeEntries, confirmEntries, dropEntry, saveEntry } from './entries';

const log = debug('lobe-server:user-profile');

export const PROFILE_SECRET_REFUSAL =
  'Not saved: this looks like a password, key, card number or identity number. Secrets are never ' +
  'kept in the profile. Tell the user so.';

export interface UserProfileView {
  /** The entries in force, in the order they were first given */
  entries: UserProfileEntry[];
  interview: UserProfileInterview;
}

/**
 * The user's profile, for Biber's tool and for the phone alike: both go through the same rules,
 * so an entry keeps its id whoever changes it.
 */
export class UserProfileService {
  private readonly model: UserProfileModel;
  private readonly now: () => Date;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string, now: () => Date = () => new Date()) {
    this.model = new UserProfileModel(db, userId);
    this.now = now;
    this.userId = userId;
  }

  async get(): Promise<UserProfileView> {
    const row = await this.model.get();
    return { entries: activeEntries(row?.entries ?? []), interview: row?.interview ?? {} };
  }

  async saveEntry(input: SaveEntryInput): Promise<ProfileOutcome> {
    if (holdsSecret(input.text)) {
      log('refused a profile entry for %s: it holds a secret', this.userId);
      return { message: PROFILE_SECRET_REFUSAL, ok: false, reason: 'secret' };
    }
    return this.model.update((state) => {
      const outcome = saveEntry(state.entries, input, this.now());
      if (outcome.ok) log('saved %s for %s', outcome.entry.id, this.userId);
      return {
        result: outcome,
        state: outcome.ok ? { ...state, entries: outcome.entries } : undefined,
      };
    });
  }

  async dropEntry(id: string): Promise<ProfileOutcome> {
    return this.model.update((state) => {
      const outcome = dropEntry(state.entries, id, this.now());
      if (outcome.ok) log('dropped %s for %s', id, this.userId);
      return {
        result: outcome,
        state: outcome.ok ? { ...state, entries: outcome.entries } : undefined,
      };
    });
  }

  async confirmEntries(ids: string[]) {
    return this.model.update((state) => {
      const { confirmed, entries, unknown } = confirmEntries(state.entries, ids, this.now());
      return {
        result: { confirmed, unknown },
        state: confirmed.length ? { ...state, entries } : undefined,
      };
    });
  }

  /**
   * Whether the phone invites the user to the interview: only someone Biber knows nothing about,
   * who has neither started it nor said "Later".
   */
  async inviteDue() {
    const { entries, interview } = await this.get();
    return !entries.length && !interview.startedAt && !interview.inviteDismissed;
  }

  /** The user said "Later" to the invite; it is not shown again. */
  async dismissInvite() {
    await this.model.update((state) => ({
      result: undefined,
      state: { ...state, interview: { ...state.interview, inviteDismissed: true } },
    }));
  }

  /** Records that the interview runs in `topicId` and is under way again. */
  async startInterview(topicId: string) {
    const startedAt = this.now().toISOString();
    await this.model.update((state) => ({
      result: undefined,
      state: {
        ...state,
        interview: {
          ...state.interview,
          finishedAt: undefined,
          startedAt: state.interview.startedAt ?? startedAt,
          topicId,
        },
      },
    }));
    log('interview for %s runs in %s', this.userId, topicId);
  }

  /** Records that Biber finished the interview; false when none was started. */
  async finishInterview() {
    const finishedAt = this.now().toISOString();
    return this.model.update((state) =>
      state.interview.startedAt
        ? { result: true, state: { ...state, interview: { ...state.interview, finishedAt } } }
        : { result: false },
    );
  }

  /**
   * Deletes every entry and the record of the interview. The first-run invite stays away: the
   * user has already met it.
   */
  async clear() {
    await this.model.update(() => ({
      result: undefined,
      state: { entries: [], interview: { inviteDismissed: true } },
    }));
    log('cleared the profile of %s', this.userId);
  }
}
