import { RemindersApiName } from '@lobechat/builtin-tool-reminders';
import { remindersExecutor } from '@lobechat/builtin-tool-reminders/client/executor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ add: vi.fn(), cancel: vi.fn(), list: vi.fn() }));

vi.mock('@/services/reminders', () => ({
  remindersService: { add: mocks.add, cancel: mocks.cancel, list: mocks.list },
}));

describe('remindersExecutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands each call to the server and returns its answer as it is', async () => {
    const answer = { content: 'Noted (id n1).', state: { reminder: { id: 'n1' } }, success: true };
    mocks.add.mockResolvedValue(answer);
    const params = { about: 'Call mom', at: '2026-11-21T18:00:00+08:00', kind: 'asked' as const };

    const result = await remindersExecutor.invoke(RemindersApiName.addReminder, params, {
      agentId: 'agent-biber',
    } as any);

    expect(mocks.add).toHaveBeenCalledWith(params, 'agent-biber');
    expect(result).toEqual(answer);
  });

  it('turns a failed request into an error the model can read', async () => {
    mocks.list.mockRejectedValue(new Error('network down'));

    const result = await remindersExecutor.invoke(RemindersApiName.listReminders, {}, {} as any);

    expect(result).toEqual({
      content: 'network down',
      error: { message: 'network down', type: 'RemindersRequestFailed' },
      success: false,
    });
  });
});
