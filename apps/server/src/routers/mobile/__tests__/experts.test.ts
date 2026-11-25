import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expertsRouter } from '../experts';

const mocks = vi.hoisted(() => ({ add: vi.fn(), list: vi.fn(), remove: vi.fn() }));

vi.mock('@/server/services/experts', () => ({
  ExpertService: vi.fn(function () {
    return { add: mocks.add, list: mocks.list, remove: mocks.remove };
  }),
}));

const caller = () => expertsRouter.createCaller({ serverDB: {} as any, userId: 'user-1' } as any);

describe('expertsRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists and adds in the phone’s language, English when it sends none', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.add.mockResolvedValue({ agentId: 'agt_1', created: true });

    await caller().list({ locale: 'zh-CN' });
    await caller().list();
    expect(mocks.list.mock.calls).toEqual([['zh-CN'], ['en-US']]);

    expect(await caller().add({ id: 'researcher', locale: 'zh-CN' })).toEqual({
      agentId: 'agt_1',
      created: true,
    });
    expect(mocks.add).toHaveBeenCalledWith('researcher', 'zh-CN');
  });

  it('says so when the expert is not in the roster', async () => {
    mocks.add.mockResolvedValue(undefined);

    await expect(caller().add({ id: 'nobody' })).rejects.toThrow('No such expert');
  });

  it('reports whether a removal removed anything', async () => {
    mocks.remove.mockResolvedValue(false);

    expect(await caller().remove({ id: 'writer' })).toEqual({ removed: false });
  });
});
