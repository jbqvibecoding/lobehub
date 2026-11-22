// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { savedLogins, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { accountHintFor, SavedLoginService, siteFromInput } from '@/server/services/savedLogins';

import { loginsRouter } from '../logins';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));

/** Stands in for the key vault: reversible, and never the plain text. */
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (text: string) => ({
        plaintext: Buffer.from(text.replace(/^enc:/, ''), 'base64').toString(),
      }),
      encrypt: async (text: string) => `enc:${Buffer.from(text).toString('base64')}`,
    }),
  },
}));

const userId = 'logins-user';
const otherUserId = 'logins-other';
const caller = (id = userId) =>
  loginsRouter.createCaller({ jwtPayload: { userId: id }, userId: id } as any);

beforeEach(async () => {
  testDB = await getTestDB();
  await testDB.delete(users);
  await testDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  delete process.env.SAVED_LOGINS_ALLOW_HTTP;
});

describe('Saved logins on the phone', () => {
  it('saves a login for one exact site, and lists it without the password', async () => {
    const saved = await caller().create({
      password: 'Hunter2-secret',
      site: 'shop.example/account/login',
      username: 'ada@qq.com',
    });

    expect(saved).toMatchObject({
      account: 'a•••@qq.com',
      label: 'shop.example',
      site: 'https://shop.example',
    });
    const listed = await caller().list();
    expect(listed).toEqual([
      expect.objectContaining({ id: saved.id, site: 'https://shop.example' }),
    ]);
    expect(JSON.stringify(listed)).not.toContain('Hunter2-secret');
    expect(JSON.stringify(listed)).not.toContain('ada@qq.com');

    const [row] = await testDB.select().from(savedLogins);
    expect(row.credentials).not.toContain('Hunter2-secret');
    expect((await new SavedLoginService(testDB, userId).secretFor(saved.id))?.secret).toEqual({
      password: 'Hunter2-secret',
      username: 'ada@qq.com',
    });
  });

  it('refuses a site it cannot bind to, and says why', async () => {
    for (const site of ['http://shop.example', 'ftp://shop.example', 'not a site at all', '']) {
      await expect(caller().create({ password: 'x', site })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'LOGIN_SITE',
      });
    }
    expect(await caller().list()).toEqual([]);
  });

  it("keeps each user's logins to themselves", async () => {
    const theirs = await caller(otherUserId).create({ password: 'x', site: 'bank.example' });

    expect(await caller().list()).toEqual([]);
    expect(await caller().delete({ id: theirs.id })).toEqual({ deleted: false });
    expect(await caller(otherUserId).list()).toHaveLength(1);
  });

  it('deletes a login with its credentials', async () => {
    const saved = await caller().create({ password: 'x', site: 'shop.example', username: 'ada' });

    expect(await caller().delete({ id: saved.id })).toEqual({ deleted: true });
    expect(await testDB.select().from(savedLogins)).toEqual([]);
  });
});

describe('siteFromInput and accountHintFor', () => {
  it('turns what the user typed into an exact site', () => {
    expect(siteFromInput('QQ.com')).toBe('https://qq.com');
    expect(siteFromInput('https://www.example.com:8443/login?next=/')).toBe(
      'https://www.example.com:8443',
    );
    expect(() => siteFromInput('https://user:pass@example.com')).toThrow();
  });

  it('takes plain http only when local testing allows it', () => {
    expect(() => siteFromInput('http://127.0.0.1:4120')).toThrow();
    process.env.SAVED_LOGINS_ALLOW_HTTP = '1';
    expect(siteFromInput('http://127.0.0.1:4120/login')).toBe('http://127.0.0.1:4120');
  });

  it('hides most of the user name', () => {
    expect(accountHintFor('ada@qq.com')).toBe('a•••@qq.com');
    expect(accountHintFor('+86 138 0013 8000')).toBe('•••• 8000');
    expect(accountHintFor('adalovelace')).toBe('ad•••');
    expect(accountHintFor('a')).toBe('•••');
    expect(accountHintFor('')).toBe('');
  });
});
