import {
  type AppRegion,
  regionalIdentifier,
  requireAppRegion,
  resolveAppRegion,
} from '../../../packages/region/src/region.ts';

/**
 * Biber's app identity per region, following the product's region rules: unsuffixed identifiers
 * belong to Global, the mainland China edition carries `cn`, `dev` is the internal build.
 */
export interface AppIdentity {
  apiUrl: string;
  /** iOS bundle identifier and Android application id. */
  bundleId: string;
  displayName: string;
  region: AppRegion;
  /** Deep link scheme; the server must trust `<scheme>://` for sign-in to return to the app. */
  scheme: string;
}

const BASE_BUNDLE_ID = 'ai.biber.app';
const BASE_SCHEME = 'biber';
const LOCAL_API_URL = 'http://localhost:3010';

/**
 * Release builds (EAS) must name their region and a real API address; a local build falls back to
 * Global and a local server.
 */
export const appIdentity = ({
  apiUrl,
  region: rawRegion,
  release,
}: {
  apiUrl?: string;
  region?: string;
  release: boolean;
}): AppIdentity => {
  const region = release
    ? requireAppRegion(rawRegion, 'a Biber mobile release build')
    : resolveAppRegion(rawRegion);

  const url = apiUrl?.trim() || (release ? '' : LOCAL_API_URL);
  if (release && !url.startsWith('https://')) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must be an https address for a Biber mobile release build',
    );
  }

  return {
    apiUrl: url.replace(/\/+$/, ''),
    bundleId: regionalIdentifier(BASE_BUNDLE_ID, region),
    displayName: region === 'dev' ? 'Biber Dev' : 'Biber',
    region,
    scheme: regionalIdentifier(BASE_SCHEME, region, '-'),
  };
};
