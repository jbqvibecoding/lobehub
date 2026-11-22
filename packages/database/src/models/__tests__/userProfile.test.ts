import type { UserProfileEntry } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { UserProfileModel } from '../../models/userProfile';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'profile-user';
const otherUserId = 'profile-other-user';

const goal = (id: string, text: string): UserProfileEntry => ({
  id,
  section: 'goals',
  status: 'active',
  text,
  updatedAt: '2026-11-22T00:00:00.000Z',
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('UserProfileModel', () => {
  it('starts a new user with an empty profile and writes what a change returns', async () => {
    const profile = new UserProfileModel(serverDB, userId);
    expect(await profile.get()).toBeUndefined();

    const seen = await profile.update((state) => ({
      result: state,
      state: { entries: [goal('G0', 'Run a marathon')], interview: { startedAt: 'now' } },
    }));

    expect(seen).toEqual({ entries: [], interview: {} });
    expect(await profile.get()).toMatchObject({
      entries: [goal('G0', 'Run a marathon')],
      interview: { startedAt: 'now' },
    });
  });

  it('writes nothing when a change returns no new profile', async () => {
    const profile = new UserProfileModel(serverDB, userId);
    await profile.update(() => ({
      result: 1,
      state: { entries: [goal('G0', 'a')], interview: {} },
    }));

    expect(await profile.update(() => ({ result: 'refused' }))).toBe('refused');
    expect((await profile.get())?.entries).toEqual([goal('G0', 'a')]);
  });

  it('lets two changes at the same moment both land', async () => {
    const profile = new UserProfileModel(serverDB, userId);
    const add = (id: string) =>
      profile.update((state) => ({
        result: id,
        state: { ...state, entries: [...state.entries, goal(id, id)] },
      }));

    await Promise.all([add('G0'), add('G1'), add('G2')]);

    expect((await profile.get())?.entries.map((entry) => entry.id).sort()).toEqual([
      'G0',
      'G1',
      'G2',
    ]);
  });

  it("never reads or changes another user's profile", async () => {
    await new UserProfileModel(serverDB, otherUserId).update(() => ({
      result: undefined,
      state: { entries: [goal('G0', 'Theirs')], interview: {} },
    }));

    const mine = new UserProfileModel(serverDB, userId);
    expect(await mine.get()).toBeUndefined();
    await mine.update((state) => ({ result: undefined, state: { ...state, entries: [] } }));

    expect((await new UserProfileModel(serverDB, otherUserId).get())?.entries).toEqual([
      goal('G0', 'Theirs'),
    ]);
  });

  it('goes when the user is deleted', async () => {
    const profile = new UserProfileModel(serverDB, userId);
    await profile.update(() => ({
      result: 1,
      state: { entries: [goal('G0', 'a')], interview: {} },
    }));

    await serverDB.delete(users);

    expect(await profile.get()).toBeUndefined();
  });
});
