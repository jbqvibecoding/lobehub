import { describe, expect, it, vi } from 'vitest';

import { MEMORY_SECRET_REFUSAL, refuseSecretMemories } from '../secretGuard';

const serviceWith = () => ({
  addIdentityMemory: vi.fn(async () => ({ identityId: 'i1', success: true })),
  addPreferenceMemory: vi.fn(async () => ({ memoryId: 'm1', success: true })),
  searchMemory: vi.fn(async () => ({ contexts: [] })),
});

describe('refuseSecretMemories', () => {
  it('refuses a memory that carries a secret without passing it on', async () => {
    const service = serviceWith();
    const guarded = refuseSecretMemories(service as any);

    await expect(
      guarded.addIdentityMemory({ description: 'Bank card 4111 1111 1111 1111' } as any),
    ).resolves.toEqual({ message: MEMORY_SECRET_REFUSAL, success: false });
    expect(service.addIdentityMemory).not.toHaveBeenCalled();
  });

  it('passes ordinary memories and reads through unchanged', async () => {
    const service = serviceWith();
    const guarded = refuseSecretMemories(service as any);

    await expect(
      guarded.addPreferenceMemory({ summary: 'Prefers window seats' } as any),
    ).resolves.toEqual({ memoryId: 'm1', success: true });
    await guarded.searchMemory({ queries: ['password manager'] } as any);

    expect(service.addPreferenceMemory).toHaveBeenCalledWith({ summary: 'Prefers window seats' });
    expect(service.searchMemory).toHaveBeenCalledWith({ queries: ['password manager'] });
  });
});
