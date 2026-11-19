import { snapdom } from '@zumer/snapdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ServerConfigStore from '@/store/serverConfig';

import { getImageUrl, ImageType } from './useScreenshot';

const mocks = vi.hoisted(() => ({ region: undefined as 'cn' | 'global' | undefined }));

vi.mock('@zumer/snapdom', () => ({
  snapdom: Object.assign(vi.fn(), {
    toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  }),
}));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof ServerConfigStore>()),
  getServerConfigStoreState: () =>
    mocks.region === undefined
      ? undefined
      : { serverConfig: { aiProvider: {}, region: mocks.region, telemetry: {} } },
}));

const proxyOf = () => vi.mocked(snapdom.toBlob).mock.calls[0][1]?.useProxy;

describe('getImageUrl', () => {
  beforeEach(() => {
    vi.mocked(snapdom.toBlob).mockClear();
    document.body.innerHTML = '<div id="preview">message</div>';
  });

  afterEach(() => {
    mocks.region = undefined;
  });

  it('fetches cross-origin images through the proxy in the Global edition', async () => {
    mocks.region = 'global';
    await getImageUrl({ imageType: ImageType.PNG });

    expect(proxyOf()).toContain('corsfix');
  });

  it.each([
    ['the mainland edition', 'cn'],
    ['an edition not yet known', undefined],
  ] as const)('keeps image addresses away from the proxy in %s', async (_, region) => {
    mocks.region = region;
    const dataUrl = await getImageUrl({ imageType: ImageType.PNG });

    expect(vi.mocked(snapdom.toBlob).mock.calls[0][1]).not.toHaveProperty('useProxy');
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
