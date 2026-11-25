// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mailRouter } from '../mail';

const mocks = vi.hoisted(() => ({
  built: [] as unknown[][],
  read: vi.fn(),
  search: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/mail', () => ({
  MailService: vi.fn().mockImplementation(function (...args: unknown[]) {
    mocks.built.push(args);
    return { read: mocks.read, search: mocks.search, send: mocks.send };
  }),
  RECIPIENT_LIMIT: 20,
}));

const caller = (userId = 'user-1') => mailRouter.createCaller({ userId } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.built = [];
  for (const mock of [mocks.read, mocks.search, mocks.send]) {
    mock.mockResolvedValue({ content: 'ok', success: true });
  }
});

describe('mailRouter', () => {
  it('runs the web chat’s mail calls on the signed-in user’s own mailbox', async () => {
    await caller('user-7').search({ query: 'invoice' });

    expect(mocks.built[0][1]).toBe('user-7');
    expect(mocks.search).toHaveBeenCalledWith({ query: 'invoice' });
  });

  it('refuses a mail to more than 20 people before reaching the mailbox', async () => {
    const to = Array.from({ length: 21 }, (_, i) => `p${i}@example.com`);

    await expect(caller().send({ body: 'hi', subject: 'x', to })).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('needs a signed-in user', async () => {
    await expect(mailRouter.createCaller({} as any).read({ id: 'INBOX:1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
