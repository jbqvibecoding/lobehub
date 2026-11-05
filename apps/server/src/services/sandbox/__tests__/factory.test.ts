import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

const baseOptions = {
  marketService: {} as MarketService,
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('sandbox service factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses the market provider by default', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {},
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('market');
    expect(service.capabilities).toMatchObject({
      backgroundCommands: true,
      exportFile: true,
      files: true,
      persistentSession: true,
      shell: true,
      skillScripts: true,
    });
  });

  it('uses the onlyboxes provider when configured', async () => {
    vi.doMock('@/envs/app', () => ({
      appEnv: {
        APP_URL: 'https://lobehub.example.com',
      },
    }));
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        ONLYBOXES_BASE_URL: 'https://onlyboxes.example.com',
        ONLYBOXES_JIT_SIGNING_KEY: 'jit-signing-key',
        SANDBOX_PROVIDER: 'onlyboxes',
      },
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('onlyboxes');
    expect(service.capabilities.languages).toEqual(['python', 'javascript', 'typescript']);
  });

  it('defaults to the openbot provider in the mainland edition', async () => {
    vi.doMock('@/envs/region', () => ({ regionEnv: { APP_REGION: 'cn' } }));
    vi.doMock('@/envs/sandbox', () => ({ sandboxEnv: {} }));

    const { getSandboxProviderKind } = await import('../factory');

    expect(getSandboxProviderKind()).toBe('openbot');
  });

  it('uses the openbot provider when configured', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        OPENBOT_COMPUTER_TOKEN: 'computer-token',
        OPENBOT_SUPERVISOR_TOKEN: 'supervisor-token',
        OPENBOT_SUPERVISOR_URL: 'http://supervisor.internal:4300',
        SANDBOX_PROVIDER: 'openbot',
      },
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('openbot');
    expect(service.capabilities).toMatchObject({ backgroundCommands: true, exportFile: true });
  });
});
