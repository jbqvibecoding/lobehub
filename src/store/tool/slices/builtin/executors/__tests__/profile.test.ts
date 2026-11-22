import { ProfileApiName } from '@lobechat/builtin-tool-profile';
import { profileExecutor } from '@lobechat/builtin-tool-profile/client/executor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirmEntries: vi.fn(),
  dropEntry: vi.fn(),
  get: vi.fn(),
  saveEntry: vi.fn(),
}));

vi.mock('@/services/profile', () => ({ profileService: mocks }));

describe('profileExecutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands each call to the server and returns its answer as it is', async () => {
    const answer = { content: 'Saved G0 (goals): "Run".', state: {}, success: true };
    mocks.saveEntry.mockResolvedValue(answer);
    const params = { section: 'goals' as const, text: 'Run' };

    const result = await profileExecutor.invoke(ProfileApiName.saveEntry, params, {} as any);

    expect(mocks.saveEntry).toHaveBeenCalledWith(params);
    expect(result).toEqual(answer);
  });

  it('turns a failed request into an error the model can read', async () => {
    mocks.dropEntry.mockRejectedValue(new Error('network down'));

    const result = await profileExecutor.invoke(ProfileApiName.dropEntry, { id: 'G0' }, {} as any);

    expect(result).toEqual({
      content: 'network down',
      error: { message: 'network down', type: 'ProfileRequestFailed' },
      success: false,
    });
  });
});
