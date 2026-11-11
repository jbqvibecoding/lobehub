/**
 * The Biber desktop app's identity per edition. Unsuffixed identifiers belong to Global; `cn` and
 * `dev` carry a suffix, following `packages/region` and the phone app. The installer config
 * (`electron-builder.mjs`) and the running app both read this, so the URL scheme the installer
 * registers is the one the app listens on. The region is fixed at build time (`APP_REGION`).
 *
 * Kept free of imports so the installer config can load it directly.
 */
export type DesktopRegion = 'cn' | 'dev' | 'global';

export const DESKTOP_PRODUCT_NAME = 'Biber';

const suffixed = (base: string, region: DesktopRegion, separator: string) =>
  region === 'global' ? base : `${base}${separator}${region}`;

export const desktopRegion = (raw: string | undefined): DesktopRegion =>
  raw === 'cn' || raw === 'dev' ? raw : 'global';

/** Distinct from the phone app's `ai.biber.app`, which can also run on a Mac. */
export const desktopAppId = (region: DesktopRegion) => suffixed('ai.biber.desktop', region, '.');

const SCHEME_BASE = 'biber-desktop';

/**
 * Deep links into the desktop app. Distinct from the phone app's `biber://` so both apps can be
 * installed on one Mac; pre-release channels add their own suffix (`biber-desktop-nightly`).
 */
export const desktopProtocolScheme = (region: DesktopRegion, channel?: string) => {
  const scheme = suffixed(SCHEME_BASE, region, '-');
  return channel ? `${scheme}-${channel}` : scheme;
};

/** Whether a URL protocol (`biber-desktop:`, `biber-desktop-cn-nightly:`, ...) is ours. */
export const isDesktopProtocol = (protocol: string) =>
  protocol === `${SCHEME_BASE}:` || protocol.startsWith(`${SCHEME_BASE}-`);

/** The hosted service each edition signs in to by default. */
const CLOUD_SERVERS: Record<DesktopRegion, string> = {
  cn: 'https://app.biber.cn',
  dev: 'https://app.biber.cn',
  global: 'https://app.biber.ai',
};

export const desktopCloudServer = (region: DesktopRegion) => CLOUD_SERVERS[region];
