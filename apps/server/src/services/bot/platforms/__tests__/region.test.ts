import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadRegistry = async (region: 'cn' | 'global') => {
  vi.doMock('@/envs/region', () => ({ regionEnv: { APP_REGION: region } }));
  const { platformRegistry } = await import('../index');
  return platformRegistry.listPlatforms().map((platform) => platform.id);
};

// Each case rebuilds the registry from a fresh module graph, slow on a cold transform cache.
describe('bot platforms by region', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('offers every platform in the global edition', async () => {
    expect(await loadRegistry('global')).toEqual([
      'discord',
      'telegram',
      'slack',
      'feishu',
      'imessage',
      'lark',
      'qq',
      'wechat',
      'line',
    ]);
  });

  it('offers only WeChat, Feishu and QQ in the mainland edition', async () => {
    expect(await loadRegistry('cn')).toEqual(['feishu', 'qq', 'wechat']);
  });
});
