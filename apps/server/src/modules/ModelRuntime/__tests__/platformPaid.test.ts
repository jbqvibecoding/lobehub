// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '../index';

const { mockGetBusinessHooks, mockGetAiProviderById } = vi.hoisted(() => ({
  mockGetAiProviderById: vi.fn(),
  mockGetBusinessHooks: vi.fn(),
}));

vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: mockGetBusinessHooks,
}));
// The deployment's own key, used when the user set none
vi.mock('@/envs/llm', () => ({ getLLMConfig: () => ({ OPENAI_API_KEY: 'sk-platform' }) }));
vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    getAiProviderById: mockGetAiProviderById,
  })),
}));

describe('initModelRuntimeFromDB: who pays for the call', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a call on the platform key as platform-paid', async () => {
    mockGetAiProviderById.mockResolvedValue({ keyVaults: {} });

    await initModelRuntimeFromDB({} as any, 'user-1', 'openai', 'ws-1');

    expect(mockGetBusinessHooks).toHaveBeenCalledWith('user-1', 'openai', 'ws-1', {
      platformPaid: true,
    });
  });

  it("does not meter a call on the user's own key, nor one with their own AWS credentials", async () => {
    mockGetAiProviderById.mockResolvedValueOnce({ keyVaults: { apiKey: 'sk-own' } });
    await initModelRuntimeFromDB({} as any, 'user-1', 'openai');

    mockGetAiProviderById.mockResolvedValueOnce({
      keyVaults: { accessKeyId: 'AKIA-own', region: 'us-east-1', secretAccessKey: 'secret' },
    });
    await initModelRuntimeFromDB({} as any, 'user-1', 'bedrock');

    expect(mockGetBusinessHooks.mock.calls.map((call) => call[3])).toEqual([
      { platformPaid: false },
      { platformPaid: false },
    ]);
  });

  it('still meters a call where the user only set a base URL', async () => {
    mockGetAiProviderById.mockResolvedValue({ keyVaults: { baseURL: 'https://proxy.example' } });

    await initModelRuntimeFromDB({} as any, 'user-1', 'openai');

    expect(mockGetBusinessHooks.mock.calls[0][3]).toEqual({ platformPaid: true });
  });
});
