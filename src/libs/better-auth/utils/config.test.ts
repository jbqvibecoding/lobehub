import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrustedOrigins } from './config';

const env = vi.hoisted(() => ({
  app: { APP_URL: 'https://app.biber.test' } as { APP_URL?: string },
  auth: {} as { AUTH_TRUSTED_ORIGINS?: string },
  region: { APP_REGION: 'global' },
}));

vi.mock('@/envs/app', () => ({ appEnv: env.app }));
vi.mock('@/envs/auth', () => ({ authEnv: env.auth }));
vi.mock('@/envs/region', () => ({ regionEnv: env.region }));
vi.mock('@/utils/env', () => ({ isDev: false }));

describe('getTrustedOrigins', () => {
  beforeEach(() => {
    env.auth.AUTH_TRUSTED_ORIGINS = undefined;
    env.region.APP_REGION = 'global';
  });

  it("trusts the app URL and the Biber app of the deployment's edition", () => {
    expect(getTrustedOrigins([])).toEqual(['https://app.biber.test', 'biber://']);

    env.region.APP_REGION = 'cn';
    expect(getTrustedOrigins([])).toEqual(['https://app.biber.test', 'biber-cn://']);

    env.region.APP_REGION = 'dev';
    expect(getTrustedOrigins([])).toEqual(['https://app.biber.test', 'biber-dev://']);
  });

  it('does not let the app of another edition sign in', () => {
    env.region.APP_REGION = 'cn';

    expect(getTrustedOrigins([])).not.toContain('biber://');
  });

  it('uses only the configured origins when they are set', () => {
    env.auth.AUTH_TRUSTED_ORIGINS = 'biber://, app.example.test';

    expect(getTrustedOrigins(['apple'])).toEqual(['biber://', 'https://app.example.test']);
  });
});
