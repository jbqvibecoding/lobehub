/**
 * The product ships as two editions built from one codebase: Global, and the separately labelled
 * mainland China edition. The rules follow Cindy's region contract:
 *
 * - The region is a build/deploy-time dimension, never a user choice. Each region is its own
 *   deployment with its own accounts, data and secrets.
 * - Where a region may be omitted, the default is `global`. Unsuffixed identifiers belong to
 *   `global`; the mainland edition carries the `cn` qualifier.
 * - Release packaging and production deployments refuse to guess: they fail when no region is given.
 * - `dev` is an internal build identity, not an edition. It behaves like `cn`.
 *
 * This file is imported directly by `apps/desktop/electron-builder.mjs` under Node's type stripping,
 * so it must stay free of imports and non-erasable TypeScript syntax.
 */

export const APP_REGIONS = ['global', 'cn', 'dev'] as const;

export type AppRegion = (typeof APP_REGIONS)[number];

export const DEFAULT_APP_REGION: AppRegion = 'global';

const isAppRegion = (value: string): value is AppRegion =>
  (APP_REGIONS as readonly string[]).includes(value);

/**
 * Reads a region value from configuration. Empty means `global`; anything that is not a known
 * region throws, because a mislabelled build or deployment is worse than one that does not start.
 */
export const resolveAppRegion = (raw?: string | null): AppRegion => {
  const value = raw?.trim().toLowerCase();
  if (!value) return DEFAULT_APP_REGION;
  if (isAppRegion(value)) return value;

  throw new Error(`Invalid APP_REGION "${raw}": expected one of ${APP_REGIONS.join(', ')}`);
};

/** For release packaging and production deployments, where the region must be explicit. */
export const requireAppRegion = (raw: string | null | undefined, context: string): AppRegion => {
  if (!raw?.trim()) {
    throw new Error(
      `APP_REGION is required for ${context}: set it to one of ${APP_REGIONS.join(', ')}`,
    );
  }

  return resolveAppRegion(raw);
};

/** Regions served from mainland China infrastructure. `dev` follows `cn`. */
export const isMainlandRegion = (region: AppRegion): boolean => region !== 'global';

/**
 * Derives an identifier per region: `global` keeps the base value, other regions append their
 * name with the given separator (`com.example.app` → `com.example.app.cn`).
 */
export const regionalIdentifier = (base: string, region: AppRegion, separator = '.'): string =>
  region === 'global' ? base : `${base}${separator}${region}`;
