import { describe, expect, it } from 'vitest';

import {
  desktopAppId,
  desktopCloudServer,
  desktopProtocolScheme,
  desktopRegion,
  isDesktopProtocol,
} from './identity';

describe('desktop identity', () => {
  it('leaves Global unsuffixed and suffixes the other editions', () => {
    expect(desktopAppId('global')).toBe('ai.biber.desktop');
    expect(desktopAppId('cn')).toBe('ai.biber.desktop.cn');
    expect(desktopProtocolScheme('global')).toBe('biber-desktop');
    expect(desktopProtocolScheme('cn', 'nightly')).toBe('biber-desktop-cn-nightly');
  });

  it("answers every edition's links and no one else's", () => {
    for (const scheme of ['biber-desktop', 'biber-desktop-cn', 'biber-desktop-nightly']) {
      expect(isDesktopProtocol(`${scheme}:`)).toBe(true);
    }
    expect(isDesktopProtocol('biber:')).toBe(false);
    expect(isDesktopProtocol('lobehub:')).toBe(false);
  });

  it('signs each edition in to its own service, Global by default', () => {
    expect(desktopCloudServer(desktopRegion(undefined))).toBe('https://app.biber.ai');
    expect(desktopCloudServer(desktopRegion('cn'))).toBe('https://app.biber.cn');
  });
});
