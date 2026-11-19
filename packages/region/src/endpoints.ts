/**
 * Where each edition's traffic goes: the service its apps talk to, and, for the mainland China
 * edition, every external service the server or the web app would otherwise reach abroad, with the
 * setting that keeps it in the region or switches it off. `preflight.ts` checks this table at
 * server start; docs/biber/operations.md explains it for operators.
 *
 * Imported directly by the phone app's build config, so it stays free of imports, non-erasable
 * TypeScript syntax, and syntax the phone app's Babel compiles to runtime helpers (array
 * destructuring, for one), since this package has no @babel/runtime of its own.
 */

/** The hosted service each edition's phone and desktop apps sign in to by default. */
export const EDITION_SERVICE_URLS: Record<'cn' | 'dev' | 'global', string> = {
  cn: 'https://app.biber.cn',
  dev: 'https://app.biber.cn',
  global: 'https://app.biber.ai',
};

type DeploymentEnv = Record<string, string | undefined>;

export interface MainlandExternalService {
  /** Where its requests go when left at the default */
  defaultHost: string;
  /** What a mainland deployment's settings get wrong for it; empty when they are fine */
  problems: (env: DeploymentEnv) => string[];
  /** What it is for */
  service: string;
}

const isSet = (value?: string) => !!value?.trim();

const list = (value?: string) =>
  (value ?? '')
    .replaceAll('，', ',')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const disablesFlag = (flags: string | undefined, flag: string) => list(flags).includes(`-${flag}`);

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
};

const jinaInRegion = (env: DeploymentEnv) =>
  env.JINA_USE_CN_DOMAINS?.trim().toLowerCase() === 'true';

/** Search providers whose service is in mainland China, or that the operator hosts. */
const MAINLAND_SEARCH_PROVIDERS = ['anspire', 'bocha', 'searxng'];

/** Sign-in services run by overseas companies, as `AUTH_SSO_PROVIDERS` names them. */
const OVERSEAS_SSO_PROVIDERS = [
  'auth0',
  'cloudflare-zero-trust',
  'cognito',
  'github',
  'google',
  'microsoft',
  'okta',
];

/** Analytics with no setting for another host: the mainland edition does not use them. */
const OVERSEAS_ANALYTICS: { key: string; name: string }[] = [
  { key: 'GOOGLE_ANALYTICS_MEASUREMENT_ID', name: 'Google Analytics' },
  { key: 'X_ADS_PIXEL_ID', name: 'the X ads pixel' },
  { key: 'CLARITY_PROJECT_ID', name: 'Microsoft Clarity' },
  { key: 'REACT_SCAN_MONITOR_API_KEY', name: 'React Scan monitoring' },
];

/** Services that may be used only from a host the operator runs in the region. */
const SELF_HOSTED: { enabledBy: string; hostKey: string; name: string; overseasHost: string }[] = [
  {
    enabledBy: 'POSTHOG_KEY',
    hostKey: 'POSTHOG_HOST',
    name: 'PostHog',
    overseasHost: 'posthog.com',
  },
  {
    enabledBy: 'PLAUSIBLE_DOMAIN',
    hostKey: 'PLAUSIBLE_SCRIPT_BASE_URL',
    name: 'Plausible',
    overseasHost: 'plausible.io',
  },
  {
    enabledBy: 'UMAMI_WEBSITE_ID',
    hostKey: 'UMAMI_SCRIPT_URL',
    name: 'Umami',
    overseasHost: 'umami.is',
  },
];

const isOverseas = (url: string | undefined, overseasHost: string) => {
  const host = hostOf(url);
  return !host || host === overseasHost || host.endsWith(`.${overseasHost}`);
};

/**
 * Every external service the mainland edition would reach abroad by default, in the order the
 * operations guide lists them.
 */
export const MAINLAND_EXTERNAL_SERVICES: MainlandExternalService[] = [
  {
    defaultHost: 'qstash.upstash.io',
    problems: (env) => {
      if (isSet(env.QSTASH_URL)) return [];
      if (env.AGENT_RUNTIME_MODE === 'queue') {
        return [
          'AGENT_RUNTIME_MODE=queue sends every agent step through Upstash QStash, which is hosted outside mainland China. Set QSTASH_URL to a QStash-compatible endpoint in the region, or use AGENT_RUNTIME_MODE=local.',
        ];
      }
      if (isSet(env.QSTASH_TOKEN)) {
        return [
          'QSTASH_TOKEN is set without QSTASH_URL, so memory extraction and other workflows go to Upstash outside mainland China. Set QSTASH_URL to a QStash-compatible endpoint in the region, or remove QSTASH_TOKEN.',
        ];
      }
      return [];
    },
    service: 'Agent queue and workflows (Upstash QStash)',
  },
  {
    defaultHost: 'market.lobehub.com',
    problems: (env) =>
      env.TELEMETRY_DISABLED === '1'
        ? []
        : [
            'TELEMETRY_DISABLED is not 1, so usage and tool-call reports go to LobeHub Market outside mainland China. Set TELEMETRY_DISABLED=1.',
          ],
    service: 'Usage telemetry and tool-call reports',
  },
  {
    defaultHost: 'market.lobehub.com',
    problems: (env) =>
      isOverseas(env.MARKET_BASE_URL, 'lobehub.com') && !disablesFlag(env.FEATURE_FLAGS, 'market')
        ? [
            'The community market (agents, plugins, skills, Market sign-in) is LobeHub Market outside mainland China. Add -market to FEATURE_FLAGS, or set MARKET_BASE_URL to a market service in the region.',
          ]
        : [],
    service: 'Community agents, plugins and skills (LobeHub Market)',
  },
  {
    defaultHost: 'api.search1api.com',
    problems: (env) => {
      const providers = list(env.SEARCH_PROVIDERS);
      if (providers.length === 0) {
        return [
          `SEARCH_PROVIDERS is not set, so web search uses Search1API outside mainland China. Set it to one of ${MAINLAND_SEARCH_PROVIDERS.join(', ')}, e.g. SEARCH_PROVIDERS=bocha.`,
        ];
      }
      return providers
        .filter(
          (provider) =>
            !MAINLAND_SEARCH_PROVIDERS.includes(provider) &&
            !(provider === 'jina' && jinaInRegion(env)),
        )
        .map((provider) =>
          provider === 'jina'
            ? 'SEARCH_PROVIDERS uses jina without JINA_USE_CN_DOMAINS=true, so searches go to s.jina.ai. Set JINA_USE_CN_DOMAINS=true.'
            : `SEARCH_PROVIDERS includes ${provider}, a search service outside mainland China. Use ${MAINLAND_SEARCH_PROVIDERS.join(', ')} instead.`,
        );
    },
    service: 'Web search',
  },
  {
    defaultHost: 'r.jina.ai, api.search1api.com',
    problems: (env) => {
      const impls = list(env.CRAWLER_IMPLS);
      if (impls.length === 0) {
        return [
          'CRAWLER_IMPLS is not set, so web pages are read through Jina and Search1API outside mainland China. Set it, e.g. CRAWLER_IMPLS=naive.',
        ];
      }
      return impls.flatMap((impl) => {
        if (impl === 'naive') return [];
        if (impl === 'jina') {
          return jinaInRegion(env)
            ? []
            : [
                'CRAWLER_IMPLS uses jina without JINA_USE_CN_DOMAINS=true, so pages are read through r.jina.ai. Set JINA_USE_CN_DOMAINS=true.',
              ];
        }
        if (impl === 'browserless' || impl === 'firecrawl') {
          const key = impl === 'browserless' ? 'BROWSERLESS_URL' : 'FIRECRAWL_URL';
          return isSet(env[key])
            ? []
            : [
                `CRAWLER_IMPLS uses ${impl} without ${key}, so pages are read through its hosted service outside mainland China. Set ${key} to an instance in the region.`,
              ];
        }
        return [
          `CRAWLER_IMPLS includes ${impl}, which reads pages through a service outside mainland China. Use naive, or jina, browserless or firecrawl hosted in the region.`,
        ];
      });
    },
    service: 'Reading web pages (crawler)',
  },
  {
    defaultHost: 'googletagmanager.com, ads-twitter.com, clarity.ms, react-scan.com',
    problems: (env) =>
      OVERSEAS_ANALYTICS.filter((analytics) => isSet(env[analytics.key])).map(
        (analytics) =>
          `${analytics.key} is set, but ${analytics.name} is served from outside mainland China and has no in-region host. Remove it.`,
      ),
    service: 'Analytics without an in-region host',
  },
  {
    defaultHost: 'posthog.com, plausible.io, umami.is',
    problems: (env) =>
      SELF_HOSTED.filter(
        ({ enabledBy, hostKey, overseasHost }) =>
          isSet(env[enabledBy]) && isOverseas(env[hostKey], overseasHost),
      ).map(
        ({ enabledBy, hostKey, name }) =>
          `${enabledBy} turns on ${name}, whose hosted service is outside mainland China. Set ${hostKey} to an instance you run in the region, or remove ${enabledBy}.`,
      ),
    service: 'Analytics with a self-hosted option',
  },
  {
    defaultHost: 'cloud.langfuse.com',
    problems: (env) =>
      env.ENABLE_LANGFUSE === '1' && isOverseas(env.LANGFUSE_HOST, 'langfuse.com')
        ? [
            'ENABLE_LANGFUSE=1 sends model traces to Langfuse Cloud outside mainland China. Set LANGFUSE_HOST to an instance you run in the region, or turn Langfuse off.',
          ]
        : [],
    service: 'Model call tracing (Langfuse)',
  },
  {
    defaultHost: 'api.resend.com',
    problems: (env) =>
      env.EMAIL_SERVICE_PROVIDER?.trim().toLowerCase() === 'resend'
        ? [
            'EMAIL_SERVICE_PROVIDER=resend sends mail through Resend outside mainland China. Use nodemailer with an SMTP service in the region.',
          ]
        : [],
    service: 'Email',
  },
  {
    defaultHost: 'accounts.google.com, github.com, login.microsoftonline.com and others',
    problems: (env) =>
      list(env.AUTH_SSO_PROVIDERS)
        .filter((provider) => OVERSEAS_SSO_PROVIDERS.includes(provider))
        .map(
          (provider) =>
            `AUTH_SSO_PROVIDERS includes ${provider}, a sign-in service outside mainland China. Mainland users sign in with their phone number; Apple, Feishu, WeChat and self-hosted OIDC (Casdoor, Keycloak, Logto, ...) also work.`,
        ),
    service: 'Single sign-on',
  },
  {
    defaultHost: 'backend.composio.dev',
    problems: (env) =>
      isSet(env.COMPOSIO_API_KEY)
        ? [
            'COMPOSIO_API_KEY is set, but Composio connects apps through its service outside mainland China. Remove it.',
          ]
        : [],
    service: 'App connectors (Composio)',
  },
  {
    defaultHost: 'edge-config.vercel.com',
    problems: (env) =>
      isSet(env.VERCEL_EDGE_CONFIG)
        ? [
            'VERCEL_EDGE_CONFIG is set, but Vercel Edge Config is outside mainland China. Remove it.',
          ]
        : [],
    service: 'Remote configuration (Vercel Edge Config)',
  },
];
