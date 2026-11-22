import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { SavedLoginModel } from '../../models/savedLogin';
import { savedLogins } from '../../schemas/savedLogin';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'login-user';
const otherUserId = 'login-other-user';

/** Stands in for the key vault: reversible, and never the plain text. */
const gateKeeper = {
  decrypt: async (ciphertext: string) => ({
    plaintext: Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString(),
  }),
  encrypt: async (plaintext: string) => `enc:${Buffer.from(plaintext).toString('base64')}`,
};

const shop = {
  accountHint: 'a•••@qq.com',
  label: 'Shop',
  origin: 'https://shop.example',
  password: 'Hunter2-secret',
  username: 'ada@qq.com',
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('SavedLoginModel', () => {
  it('keeps the user name and password encrypted, and decrypts them only on request', async () => {
    const logins = new SavedLoginModel(serverDB, userId, gateKeeper);

    const saved = await logins.create(shop);

    expect(saved).toMatchObject({ accountHint: 'a•••@qq.com', label: 'Shop' });
    expect(saved).not.toHaveProperty('credentials');
    const [row] = await serverDB.select().from(savedLogins);
    expect(row.credentials).not.toContain('Hunter2-secret');
    expect(row.credentials).not.toContain('ada@qq.com');

    expect(await logins.list()).toEqual([
      expect.not.objectContaining({ credentials: expect.anything() }),
    ]);
    expect(JSON.stringify(await logins.list())).not.toContain('Hunter2-secret');
    expect(await logins.secretFor(saved.id)).toMatchObject({
      origin: 'https://shop.example',
      secret: { password: 'Hunter2-secret', username: 'ada@qq.com' },
    });
  });

  it('holds several logins, even for one site', async () => {
    const logins = new SavedLoginModel(serverDB, userId, gateKeeper);
    await logins.create(shop);
    await logins.create({ ...shop, accountHint: 'b•••@qq.com', label: 'Shop (work)' });
    await logins.create({ ...shop, label: 'Bank', origin: 'https://bank.example' });

    expect((await logins.list()).map((login) => login.label)).toEqual([
      'Bank',
      'Shop',
      'Shop (work)',
    ]);
  });

  it("never reads, uses or deletes another user's login", async () => {
    const theirs = await new SavedLoginModel(serverDB, otherUserId, gateKeeper).create(shop);
    const mine = new SavedLoginModel(serverDB, userId, gateKeeper);

    expect(await mine.list()).toEqual([]);
    expect(await mine.find(theirs.id)).toBeUndefined();
    expect(await mine.secretFor(theirs.id)).toBeUndefined();
    expect(await mine.remove(theirs.id)).toBe(false);
    expect(await serverDB.select().from(savedLogins)).toHaveLength(1);
  });

  it('notes when a login was used, and deletes it with its credentials', async () => {
    const logins = new SavedLoginModel(serverDB, userId, gateKeeper);
    const saved = await logins.create(shop);

    await logins.touch(saved.id);
    expect((await logins.find(saved.id))?.lastUsedAt).toBeInstanceOf(Date);

    expect(await logins.remove(saved.id)).toBe(true);
    expect(await serverDB.select().from(savedLogins)).toEqual([]);
  });
});
