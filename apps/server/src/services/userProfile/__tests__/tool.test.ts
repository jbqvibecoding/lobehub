import { ProfileApiName, ProfileIdentifier } from '@lobechat/builtin-tool-profile';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { users } from '@/database/schemas/user';
import { profileRuntime } from '@/server/services/toolExecution/serverRuntimes/profile';

import { UserProfileService } from '../index';

const db = await getTestDB();
const userId = 'profile-tool-user';
const otherUserId = 'profile-tool-other';

const runtimeFor = (id: string) =>
  profileRuntime.factory({ serverDB: db, userId: id } as any) as Record<
    string,
    (args: any) => Promise<{ content: string; error?: { type: string }; success: boolean }>
  >;

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('the profile tool', () => {
  it('answers every API of the manifest', () => {
    expect(profileRuntime.identifier).toBe(ProfileIdentifier);
    expect(Object.keys(runtimeFor(userId)).sort()).toEqual(Object.values(ProfileApiName).sort());
  });

  it("saves, changes, confirms and deletes entries in the running user's profile", async () => {
    const tool = runtimeFor(userId);

    expect(
      await tool.saveEntry({ section: 'goals', text: 'Run a marathon before October' }),
    ).toEqual(
      expect.objectContaining({
        content: 'Saved G0 (goals): "Run a marathon before October".',
        success: true,
      }),
    );
    expect(
      (await tool.saveEntry({ id: 'G0', section: 'goals', text: 'Before November' })).content,
    ).toBe('Saved G0 (goals): "Before November".');
    expect((await tool.saveEntry({ section: 'people', text: 'Lin, my wife' })).content).toBe(
      'Saved PE0 (people): "Lin, my wife".',
    );
    expect((await tool.confirmEntries({ ids: ['G0', 'G5'] })).content).toBe(
      'Confirmed G0 as still holding. There is no G5.',
    );
    expect((await tool.dropEntry({ id: 'PE0' })).content).toBe('Deleted PE0.');

    const { entries } = await new UserProfileService(db, userId).get();
    expect(entries).toEqual([
      expect.objectContaining({
        id: 'G0',
        reviewedAt: expect.any(String),
        text: 'Before November',
      }),
    ]);
    expect((await new UserProfileService(db, otherUserId).get()).entries).toEqual([]);
  });

  it('refuses secrets, and says why a save did not fit', async () => {
    const tool = runtimeFor(userId);

    const secret = await tool.saveEntry({
      section: 'now',
      text: 'My bank card is 4111 1111 1111 1111',
    });
    expect(secret).toMatchObject({ error: { type: 'Profile_secret' }, success: false });
    expect(secret.content).toContain('Secrets are never kept in the profile');

    await tool.saveEntry({ section: 'name', text: '小安' });
    expect(await tool.saveEntry({ section: 'name', text: 'An' })).toMatchObject({
      error: { type: 'Profile_exists' },
      success: false,
    });
    expect(await tool.dropEntry({ id: 'G3' })).toMatchObject({
      error: { type: 'Profile_not_found' },
      success: false,
    });
    expect(await tool.confirmEntries({ ids: ['G3'] })).toMatchObject({ success: false });

    expect((await new UserProfileService(db, userId).get()).entries).toEqual([
      expect.objectContaining({ id: 'name', text: '小安' }),
    ]);
  });

  it("cannot reach another user's entries", async () => {
    await runtimeFor(otherUserId).saveEntry({ section: 'goals', text: 'Theirs' });

    expect(await runtimeFor(userId).dropEntry({ id: 'G0' })).toMatchObject({ success: false });
    expect(
      await runtimeFor(userId).saveEntry({ id: 'G0', section: 'goals', text: 'Mine now' }),
    ).toMatchObject({ success: false });
    expect((await new UserProfileService(db, otherUserId).get()).entries).toEqual([
      expect.objectContaining({ id: 'G0', text: 'Theirs' }),
    ]);
  });

  it('clears everything but keeps the first-run invite away', async () => {
    const profile = new UserProfileService(db, userId);
    await runtimeFor(userId).saveEntry({ section: 'goals', text: 'Run' });

    await profile.clear();

    expect(await profile.get()).toEqual({ entries: [], interview: { inviteDismissed: true } });
    expect((await runtimeFor(userId).saveEntry({ section: 'goals', text: 'Swim' })).content).toBe(
      'Saved G0 (goals): "Swim".',
    );
  });
});
