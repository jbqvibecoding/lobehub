import { RemindersApiName, RemindersIdentifier } from '@lobechat/builtin-tool-reminders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { remindersRuntime } from '../reminders';

const mocks = vi.hoisted(() => ({ add: vi.fn(), cancel: vi.fn(), list: vi.fn() }));

vi.mock('@/server/services/proactive/notes', () => ({
  addReminder: mocks.add,
  cancelReminder: mocks.cancel,
  listReminders: mocks.list,
}));

const serverDB = {} as any;

describe('remindersRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of Object.values(mocks))
      mock.mockResolvedValue({ content: 'ok', success: true });
  });

  it('answers every API of the manifest, for the running agent’s user', async () => {
    expect(remindersRuntime.identifier).toBe(RemindersIdentifier);
    const runtime = remindersRuntime.factory({
      agentId: 'agent-biber',
      serverDB,
      userId: 'user-1',
    } as any);
    expect(Object.keys(runtime).sort()).toEqual(Object.values(RemindersApiName).sort());

    const args = { about: 'Call mom', at: '2026-11-21T18:00:00+08:00', kind: 'asked' as const };
    await runtime.addReminder(args);
    expect(mocks.add).toHaveBeenCalledWith(
      { agentId: 'agent-biber', db: serverDB, userId: 'user-1' },
      args,
    );
    await runtime.listReminders();
    await runtime.cancelReminder({ id: 'note-1' });
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
      id: 'note-1',
    });
  });

  it('refuses to run without a user', () => {
    expect(() => remindersRuntime.factory({ serverDB } as any)).toThrow(/userId/);
  });
});
