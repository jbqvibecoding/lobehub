import { describe, expect, it } from 'vitest';

import { assertRegionDeployment, regionDeploymentProblems } from './preflight';

/** A mainland deployment that keeps every external service in the region or switched off. */
const MAINLAND = {
  APP_REGION: 'cn',
  CRAWLER_IMPLS: 'naive',
  FEATURE_FLAGS: '-market',
  NODE_ENV: 'production',
  SEARCH_PROVIDERS: 'bocha',
  SYSTEM_AGENT: 'default=deepseek/deepseek-chat',
  TELEMETRY_DISABLED: '1',
};

describe('regionDeploymentProblems', () => {
  it('requires production deployments to name their region', () => {
    expect(regionDeploymentProblems({ NODE_ENV: 'production' })).toEqual([
      expect.stringContaining('APP_REGION is not set'),
    ]);
    expect(regionDeploymentProblems({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('lets a global deployment use the hosted queue, market, search and analytics', () => {
    expect(
      regionDeploymentProblems({
        AGENT_RUNTIME_MODE: 'queue',
        APP_REGION: 'global',
        AUTH_SSO_PROVIDERS: 'google,github',
        GOOGLE_ANALYTICS_MEASUREMENT_ID: 'G-1',
        NODE_ENV: 'production',
        QSTASH_TOKEN: 'token',
        SANDBOX_PROVIDER: 'market',
      }),
    ).toEqual([]);
  });

  it('accepts a mainland deployment that keeps its external services in the region', () => {
    expect(regionDeploymentProblems(MAINLAND)).toEqual([]);
    expect(
      regionDeploymentProblems({
        ...MAINLAND,
        AGENT_RUNTIME_MODE: 'queue',
        AUTH_SSO_PROVIDERS: 'apple, feishu，wechat,casdoor',
        BROWSERLESS_URL: 'https://browserless.internal.example.cn',
        CRAWLER_IMPLS: 'naive，jina,browserless',
        EMAIL_SERVICE_PROVIDER: 'nodemailer',
        ENABLE_LANGFUSE: '1',
        FEATURE_FLAGS: '',
        JINA_USE_CN_DOMAINS: 'true',
        LANGFUSE_HOST: 'https://langfuse.internal.example.cn',
        MARKET_BASE_URL: 'https://market.example.cn',
        POSTHOG_HOST: 'https://posthog.internal.example.cn',
        POSTHOG_KEY: 'phc_x',
        QSTASH_TOKEN: 'token',
        QSTASH_URL: 'https://qstash.internal.example.cn',
        SANDBOX_PROVIDER: 'openbot',
        SEARCH_PROVIDERS: 'searxng,jina,anspire',
      }),
    ).toEqual([]);
  });

  it('tells a bare mainland deployment what to set', () => {
    expect(regionDeploymentProblems({ APP_REGION: 'cn' })).toEqual([
      expect.stringContaining('Set TELEMETRY_DISABLED=1'),
      expect.stringContaining('Add -market to FEATURE_FLAGS'),
      expect.stringContaining('SEARCH_PROVIDERS is not set'),
      expect.stringContaining('CRAWLER_IMPLS is not set'),
      expect.stringContaining('SYSTEM_AGENT has no default'),
    ]);
  });

  it.each([
    ['the queue without an in-region QStash', { AGENT_RUNTIME_MODE: 'queue' }, 'Set QSTASH_URL'],
    ['workflows on Upstash', { QSTASH_TOKEN: 'token' }, 'QSTASH_TOKEN is set without QSTASH_URL'],
    ['telemetry left on', { TELEMETRY_DISABLED: '0' }, 'TELEMETRY_DISABLED is not 1'],
    [
      'LobeHub Market',
      { FEATURE_FLAGS: '+market', MARKET_BASE_URL: 'https://market.lobehub.com' },
      'Add -market to FEATURE_FLAGS',
    ],
    ['an overseas search service', { SEARCH_PROVIDERS: 'bocha,tavily' }, 'includes tavily'],
    ['Jina search on its global domain', { SEARCH_PROVIDERS: 'jina' }, 'JINA_USE_CN_DOMAINS'],
    ['Search1API to read pages', { CRAWLER_IMPLS: 'naive,search1api' }, 'includes search1api'],
    ['hosted Firecrawl', { CRAWLER_IMPLS: 'firecrawl' }, 'without FIRECRAWL_URL'],
    ['Google Analytics', { GOOGLE_ANALYTICS_MEASUREMENT_ID: 'G-1' }, 'Google Analytics'],
    ['PostHog Cloud', { POSTHOG_KEY: 'phc_x' }, 'Set POSTHOG_HOST'],
    [
      'Umami Cloud',
      { UMAMI_SCRIPT_URL: 'https://cloud.umami.is/script.js', UMAMI_WEBSITE_ID: 'u' },
      'Set UMAMI_SCRIPT_URL',
    ],
    ['Langfuse Cloud', { ENABLE_LANGFUSE: '1' }, 'Set LANGFUSE_HOST'],
    ['Resend', { EMAIL_SERVICE_PROVIDER: 'Resend' }, 'Use nodemailer'],
    ['Google sign-in', { AUTH_SSO_PROVIDERS: 'apple,google' }, 'includes google'],
    ['Composio', { COMPOSIO_API_KEY: 'key' }, 'Composio'],
    [
      'system tasks on OpenAI',
      { SYSTEM_AGENT: 'topic=deepseek/deepseek-chat' },
      'SYSTEM_AGENT has no default',
    ],
    [
      'an overseas model for a system task',
      { SYSTEM_AGENT: 'default=deepseek/deepseek-chat，topic=openai/gpt-4o-mini' },
      'SYSTEM_AGENT gives topic to openai',
    ],
    [
      'Vercel Edge Config',
      { VERCEL_EDGE_CONFIG: 'https://edge-config.vercel.com/x' },
      'Edge Config',
    ],
  ])('refuses %s in the mainland edition', (_, settings, message) => {
    expect(regionDeploymentProblems({ ...MAINLAND, ...settings })).toEqual([
      expect.stringContaining(message),
    ]);
  });

  it('keeps Stripe to the Global edition', () => {
    const stripe = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x' };

    expect(regionDeploymentProblems({ ...stripe, APP_REGION: 'global' })).toEqual([]);
    expect(regionDeploymentProblems({ ...MAINLAND, ...stripe })).toEqual([
      expect.stringContaining('Stripe bills the Global edition only'),
    ]);
  });

  it('keeps the Market sandbox out of the mainland edition', () => {
    expect(regionDeploymentProblems({ ...MAINLAND, SANDBOX_PROVIDER: 'market' })).toEqual([
      expect.stringContaining('SANDBOX_PROVIDER=market'),
    ]);
  });

  it('keeps overseas model providers out of the mainland edition', () => {
    const problems = regionDeploymentProblems({
      ...MAINLAND,
      DEEPSEEK_API_KEY: 'sk-ds',
      DEFAULT_AGENT_CONFIG: 'provider=openai;model=gpt-4o',
      OPENAI_API_KEY: 'sk-oa',
    });

    expect(problems).toEqual([
      expect.stringContaining('OPENAI_API_KEY is set'),
      expect.stringContaining('DEFAULT_AGENT_CONFIG makes openai the default provider'),
    ]);
    expect(
      regionDeploymentProblems({
        ...MAINLAND,
        DEFAULT_AGENT_CONFIG: 'provider=deepseek;model=deepseek-chat',
      }),
    ).toEqual([]);
    expect(
      regionDeploymentProblems({
        APP_REGION: 'global',
        NODE_ENV: 'production',
        OPENAI_API_KEY: 'x',
      }),
    ).toEqual([]);
  });

  it('keeps the coding expert’s model calls in the region', () => {
    expect(regionDeploymentProblems({ ...MAINLAND, CODING_MODEL_PROVIDER: 'anthropic' })).toEqual([
      expect.stringContaining('CODING_MODEL_PROVIDER=anthropic'),
    ]);
    expect(regionDeploymentProblems({ ...MAINLAND, CODING_MODEL_PROVIDER: 'deepseek' })).toEqual(
      [],
    );
    expect(
      regionDeploymentProblems({
        APP_REGION: 'global',
        CODING_MODEL_PROVIDER: 'anthropic',
        NODE_ENV: 'production',
      }),
    ).toEqual([]);
  });
});

describe('assertRegionDeployment', () => {
  it('stops the start with every problem listed', () => {
    expect(() => assertRegionDeployment({ ...MAINLAND, SANDBOX_PROVIDER: 'market' })).toThrow(
      /does not fit its region:\n- SANDBOX_PROVIDER=market/,
    );
  });

  it('refuses an unknown region', () => {
    expect(() => assertRegionDeployment({ APP_REGION: 'mars' })).toThrow('Invalid APP_REGION');
  });
});
