import { describe, expect, it } from 'vitest';

import { assertRegionDeployment, regionDeploymentProblems } from './preflight';

describe('regionDeploymentProblems', () => {
  it('requires production deployments to name their region', () => {
    expect(regionDeploymentProblems({ NODE_ENV: 'production' })).toEqual([
      expect.stringContaining('APP_REGION is not set'),
    ]);
    expect(regionDeploymentProblems({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('lets a global deployment use the hosted queue and the Market sandbox', () => {
    expect(
      regionDeploymentProblems({
        AGENT_RUNTIME_MODE: 'queue',
        APP_REGION: 'global',
        NODE_ENV: 'production',
        SANDBOX_PROVIDER: 'market',
      }),
    ).toEqual([]);
  });

  it('rejects services hosted abroad in the mainland edition', () => {
    const problems = regionDeploymentProblems({
      AGENT_RUNTIME_MODE: 'queue',
      APP_REGION: 'cn',
      NODE_ENV: 'production',
      SANDBOX_PROVIDER: 'market',
    });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('QSTASH_URL');
    expect(problems[1]).toContain('SANDBOX_PROVIDER=market');
  });

  it('keeps Stripe to the Global edition', () => {
    const stripe = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x' };

    expect(regionDeploymentProblems({ ...stripe, APP_REGION: 'global' })).toEqual([]);
    expect(regionDeploymentProblems({ ...stripe, APP_REGION: 'cn' })).toEqual([
      expect.stringContaining('Stripe bills the Global edition only'),
    ]);
  });

  it('accepts a mainland queue that points at a QStash-compatible endpoint in the region', () => {
    expect(
      regionDeploymentProblems({
        AGENT_RUNTIME_MODE: 'queue',
        APP_REGION: 'cn',
        QSTASH_URL: 'https://qstash.internal.example.cn',
        SANDBOX_PROVIDER: 'openbot',
      }),
    ).toEqual([]);
  });
});

describe('assertRegionDeployment', () => {
  it('stops the start with every problem listed', () => {
    expect(() => assertRegionDeployment({ APP_REGION: 'cn', SANDBOX_PROVIDER: 'market' })).toThrow(
      /does not fit its region:\n- SANDBOX_PROVIDER=market/,
    );
  });

  it('refuses an unknown region', () => {
    expect(() => assertRegionDeployment({ APP_REGION: 'mars' })).toThrow('Invalid APP_REGION');
  });
});
