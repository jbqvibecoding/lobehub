import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { PersonalAccountModel } from '../../models/personalAccount';
import { personalAccounts } from '../../schemas/personalAccount';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'account-user';
const otherUserId = 'account-other-user';

/** Stands in for the key vault: reversible, and never the plain text. */
const gateKeeper = {
  decrypt: async (ciphertext: string) => ({
    plaintext: Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString(),
  }),
  encrypt: async (plaintext: string) => `enc:${Buffer.from(plaintext).toString('base64')}`,
};

const mailbox = {
  credentials: 'app-password-1',
  kind: 'mail' as const,
  label: 'ada@qq.com',
  provider: 'imap' as const,
  settings: { imapHost: 'imap.qq.com', imapPort: 993 },
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('PersonalAccountModel', () => {
  it('stores the password encrypted and gives it back decrypted', async () => {
    const accounts = new PersonalAccountModel(serverDB, userId, gateKeeper);

    const saved = await accounts.save(mailbox);

    expect(saved).not.toHaveProperty('credentials');
    const [row] = await serverDB.select().from(personalAccounts);
    expect(row.credentials).not.toContain('app-password-1');
    expect(await accounts.find('mail')).toMatchObject({
      credentials: 'app-password-1',
      label: 'ada@qq.com',
      status: 'active',
    });
    expect(await accounts.list()).toEqual([
      expect.not.objectContaining({ credentials: expect.anything() }),
    ]);
  });

  it('keeps one mailbox per user: connecting again replaces it', async () => {
    const accounts = new PersonalAccountModel(serverDB, userId, gateKeeper);
    await accounts.save(mailbox);
    await accounts.update('mail', { lastError: 'login failed', status: 'needs_reauth' });

    await accounts.save({ ...mailbox, credentials: 'app-password-2', label: 'ada@163.com' });

    const rows = await serverDB.select().from(personalAccounts);
    expect(rows).toHaveLength(1);
    expect(await accounts.find('mail')).toMatchObject({
      credentials: 'app-password-2',
      label: 'ada@163.com',
      lastError: null,
      status: 'active',
    });
  });

  it('updates credentials encrypted, and removes the account with them', async () => {
    const accounts = new PersonalAccountModel(serverDB, userId, gateKeeper);
    await accounts.save({ ...mailbox, kind: 'calendar', provider: 'feishu' });

    await accounts.update('calendar', { credentials: '{"accessToken":"t2"}' });
    expect((await accounts.find('calendar'))?.credentials).toBe('{"accessToken":"t2"}');

    expect(await accounts.remove('calendar')).toBe(true);
    expect(await accounts.remove('calendar')).toBe(false);
    expect(await serverDB.select().from(personalAccounts)).toHaveLength(0);
  });

  it("keeps each user's accounts to themselves", async () => {
    await new PersonalAccountModel(serverDB, userId, gateKeeper).save(mailbox);
    const other = new PersonalAccountModel(serverDB, otherUserId, gateKeeper);

    expect(await other.find('mail')).toBeUndefined();
    expect(await other.list()).toEqual([]);
    expect(await other.remove('mail')).toBe(false);
    await other.update('mail', { status: 'needs_reauth' });
    expect(
      (await new PersonalAccountModel(serverDB, userId, gateKeeper).find('mail'))?.status,
    ).toBe('active');
  });
});
