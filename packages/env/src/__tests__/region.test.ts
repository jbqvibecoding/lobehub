// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getRegionConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.APP_REGION;
  });

  it('serves the global edition when no region is set', async () => {
    process.env.APP_REGION = '';
    const { getRegionConfig } = await import('../region');

    expect(getRegionConfig().APP_REGION).toBe('global');
  });

  it('reads the mainland edition from loosely written values', async () => {
    process.env.APP_REGION = ' CN ';
    const { getRegionConfig } = await import('../region');

    expect(getRegionConfig().APP_REGION).toBe('cn');
  });

  it('refuses an unknown region', async () => {
    process.env.APP_REGION = 'china';

    await expect(import('../region')).rejects.toThrow();
  });
});
