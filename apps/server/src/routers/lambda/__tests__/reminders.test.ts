import { beforeEach, describe, expect, it, vi } from 'vitest';

import { remindersRouter } from '@/server/routers/lambda/reminders';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/server/services/proactive/notes', () => ({
  addReminder: mocks.add,
  cancelReminder: mocks.cancel,
  listReminders: mocks.list,
}));

const serverDB = {} as any;
const caller = (userId: string | null = 'user-1') =>
  remindersRouter.createCaller({ serverDB, userId } as any);

describe('remindersRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of Object.values(mocks))
      mock.mockResolvedValue({ content: 'ok', success: true });
  });

  it('runs the tool for the signed-in user only, in the browser’s time zone', async () => {
    await caller().add({
      about: 'Call mom',
      agentId: 'agent-biber',
      at: '2026-11-21T18:00:00+08:00',
      kind: 'asked',
      timeZone: 'Asia/Shanghai',
    });
    expect(mocks.add).toHaveBeenCalledWith(
      { agentId: 'agent-biber', db: serverDB, timeZone: 'Asia/Shanghai', userId: 'user-1' },
      { about: 'Call mom', at: '2026-11-21T18:00:00+08:00', kind: 'asked' },
    );

    await caller().list({ timeZone: 'Asia/Shanghai' });
    expect(mocks.list).toHaveBeenCalledWith({
      db: serverDB,
      timeZone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    await caller().cancel({ id: 'note-1' });
    expect(mocks.cancel).toHaveBeenCalledWith({ db: serverDB, userId: 'user-1' }, { id: 'note-1' });
  });

  it('turns away a caller who is not signed in', async () => {
    await expect(caller(null).list()).rejects.toThrow();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
