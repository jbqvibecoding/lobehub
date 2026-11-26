import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPasskeyOrigins, getTrustedOrigins } from './config';

const mocks = vi.hoisted(() => ({
  appEnv: { APP_URL: 'https://app.biber.test' } as { APP_URL?: string },
  authEnv: {
    AUTH_ADDITIONAL_TRUSTED_ORIGINS: undefined as string | undefined,
    AUTH_TRUSTED_ORIGINS: undefined as string | undefined,
  },
  regionEnv: { APP_REGION: 'global' },
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));
vi.mock('@/envs/region', () => ({ regionEnv: mocks.regionEnv }));
vi.mock('@/envs/redis', () => ({ getRedisConfig: vi.fn() }));
vi.mock('@/server/modules/Redis', () => ({
  initializeRedis: vi.fn(),
  isRedisEnabled: vi.fn(() => false),
}));
vi.mock('@/utils/env', () => ({ isDev: false }));

// The asset links name LobeHub's app too; only Biber's app of the edition may use its passkeys
vi.mock('@/../public/.well-known/assetlinks.json', () => ({
  default: [
    {
      relation: ['delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: 'com.lobehub.app',
        sha256_cert_fingerprints: [
          'D7:54:DB:A3:78:D5:8B:8F:20:01:ED:7B:9B:18:D3:B0:5B:D1:22:AA:97:2B:59:E1:A6:8E:31:24:21:44:0D:2B',
        ],
      },
    },
    {
      relation: ['delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: 'ai.biber.app',
        sha256_cert_fingerprints: [
          'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C',
        ],
      },
    },
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'ai.biber.app.cn',
        sha256_cert_fingerprints: [
          '1B:21:38:5D:72:40:65:F5:16:20:1D:C9:D2:6B:04:63:C3:33:F1:97:AB:6A:06:66:0E:3E:F0:7E:60:82:7E:E7',
        ],
      },
    },
  ],
}));

const BIBER_GLOBAL_APP = 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w';

describe('getTrustedOrigins', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mocks.appEnv.APP_URL = 'https://app.biber.test';
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = undefined;
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = undefined;
    mocks.regionEnv.APP_REGION = 'global';
    process.env = { ...originalEnv };
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("trusts the app URL and the Biber app of the deployment's edition", () => {
    expect(getTrustedOrigins([])).toEqual(['https://app.biber.test', 'biber://']);

    mocks.regionEnv.APP_REGION = 'cn';
    expect(getTrustedOrigins([])).toEqual(['https://app.biber.test', 'biber-cn://']);

    mocks.regionEnv.APP_REGION = 'dev';
    expect(getTrustedOrigins([])).toEqual(['https://app.biber.test', 'biber-dev://']);
  });

  it('does not let the app of another edition sign in', () => {
    mocks.regionEnv.APP_REGION = 'cn';

    expect(getTrustedOrigins([])).not.toContain('biber://');
  });

  it('uses only the configured origins when they are set', () => {
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = 'biber://, app.example.test';

    expect(getTrustedOrigins(['apple'])).toEqual(['biber://', 'https://app.example.test']);
  });

  it('appends normalized additional origins to the defaults', () => {
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = [
      'https://gateway.example.com/signin',
      'gateway.example.com/another-path',
    ].join(',');

    expect(getTrustedOrigins(['apple'])).toEqual([
      'https://app.biber.test',
      'biber://',
      'https://appleid.apple.com',
      'https://gateway.example.com',
    ]);
  });

  it('appends additional origins without changing the override', () => {
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = 'https://override.example.com/callback';
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = 'https://gateway.example.com/signin';

    expect(getTrustedOrigins(['apple'])).toEqual([
      'https://override.example.com',
      'https://gateway.example.com',
    ]);
  });
});

describe('getPasskeyOrigins', () => {
  beforeEach(() => {
    mocks.appEnv.APP_URL = 'https://app.biber.test';
    mocks.regionEnv.APP_REGION = 'global';
  });

  it("trusts the web app and the edition's own Android app, never another app", () => {
    expect(getPasskeyOrigins()).toEqual(['https://app.biber.test', BIBER_GLOBAL_APP]);
  });

  it('trusts no Android app of an edition whose app may not use login credentials', () => {
    mocks.regionEnv.APP_REGION = 'cn';

    expect(getPasskeyOrigins()).toEqual(['https://app.biber.test']);
  });

  it('has no origins when the web app URL is unavailable', () => {
    mocks.appEnv.APP_URL = '';

    expect(getPasskeyOrigins()).toBeUndefined();
  });
});
