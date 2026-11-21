import { MailApiName, MailIdentifier } from '@lobechat/builtin-tool-mail';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mailRuntime } from '../mail';

const mocks = vi.hoisted(() => ({
  built: [] as unknown[][],
  read: vi.fn(),
  search: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/server/services/mail', () => ({
  MailService: vi.fn().mockImplementation((...args: unknown[]) => {
    mocks.built.push(args);
    return { read: mocks.read, search: mocks.search, send: mocks.send };
  }),
}));

const serverDB = {} as any;

describe('mailRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.built = [];
    for (const mock of [mocks.read, mocks.search, mocks.send]) {
      mock.mockResolvedValue({ content: 'ok', success: true });
    }
  });

  it('answers every API of the manifest from the running user’s mailbox', async () => {
    expect(mailRuntime.identifier).toBe(MailIdentifier);
    const runtime = mailRuntime.factory({ serverDB, userId: 'user-1' } as any);

    expect(Object.keys(runtime).sort()).toEqual(Object.values(MailApiName).sort());
    expect(mocks.built).toEqual([[serverDB, 'user-1']]);

    await runtime.searchMail({ unreadOnly: true });
    await runtime.readMail({ id: 'INBOX:7' });
    const mail = { body: 'Yes', replyToId: 'INBOX:7', to: ['ana@example.com'] };
    await runtime.sendMail(mail);
    expect(mocks.search).toHaveBeenCalledWith({ unreadOnly: true });
    expect(mocks.read).toHaveBeenCalledWith({ id: 'INBOX:7' });
    expect(mocks.send).toHaveBeenCalledWith(mail);
  });

  it('needs to know whose mailbox it is', () => {
    expect(() => mailRuntime.factory({ serverDB } as any)).toThrow('userId and serverDB');
  });
});
