import { describe, expect, it } from 'vitest';

import { EDITION_SERVICE_URLS } from './endpoints';

// The desktop app is its own TypeScript project, so its identity is loaded at run time only
const DESKTOP_IDENTITY = new URL('../../../apps/desktop/src/common/identity.ts', import.meta.url)
  .href;

describe('EDITION_SERVICE_URLS', () => {
  it('is the service the desktop app signs in to, edition by edition', async () => {
    const { desktopCloudServer } = await import(/* @vite-ignore */ DESKTOP_IDENTITY);

    for (const region of ['cn', 'dev', 'global'] as const) {
      expect(desktopCloudServer(region)).toBe(EDITION_SERVICE_URLS[region]);
    }
  });
});
