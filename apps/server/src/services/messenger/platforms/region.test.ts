import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadRegistry = async (region: 'cn' | 'global') => {
  vi.doMock('@/envs/region', () => ({ regionEnv: { APP_REGION: region } }));
  const { messengerPlatformRegistry } = await import('./index');
  return messengerPlatformRegistry.listPlatforms().map((platform) => platform.id);
};

// Each case rebuilds the registry from a fresh module graph, slow on a cold transform cache.
describe('messenger platforms by region', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('runs every shared bot in the global edition', async () => {
    expect(await loadRegistry('global')).toEqual([
      'slack',
      'telegram',
      'discord',
      'imessage',
      'lark',
      'feishu',
      'wechat',
    ]);
  });

  it('runs only Feishu and WeChat in the mainland edition', async () => {
    expect(await loadRegistry('cn')).toEqual(['feishu', 'wechat']);
  });
});
