import { isModelProviderAvailable } from './availability';
import { MAINLAND_EXTERNAL_SERVICES } from './endpoints';
import { isMainlandRegion, resolveAppRegion } from './region';

/** Platform keys for overseas model providers, which the mainland edition does not offer. */
const OVERSEAS_MODEL_KEYS = [
  'ANTHROPIC_API_KEY',
  'AZURE_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY',
  'XAI_API_KEY',
];

type DeploymentEnv = Record<string, string | undefined>;

/**
 * Configuration that a region's deployment must not run with. Each entry names the setting and
 * what to do instead, so the operator can fix it from the message alone.
 */
export const regionDeploymentProblems = (env: DeploymentEnv): string[] => {
  const region = resolveAppRegion(env.APP_REGION);
  const problems: string[] = [];

  if (env.NODE_ENV === 'production' && !env.APP_REGION?.trim()) {
    problems.push(
      'APP_REGION is not set: a production deployment must say which edition it serves (global or cn).',
    );
  }

  if (!isMainlandRegion(region)) return problems;

  for (const external of MAINLAND_EXTERNAL_SERVICES) problems.push(...external.problems(env));

  if (env.STRIPE_SECRET_KEY?.trim()) {
    problems.push(
      'STRIPE_SECRET_KEY is set, but Stripe bills the Global edition only. The mainland edition is paid through WeChat Pay and Alipay; remove the Stripe keys.',
    );
  }

  for (const key of OVERSEAS_MODEL_KEYS) {
    if (env[key]?.trim()) {
      problems.push(
        `${key} is set, but the mainland edition offers only model providers serving from mainland China (see MAINLAND_MODEL_PROVIDERS in @lobechat/region). Remove it.`,
      );
    }
  }

  if (env.CODING_MODEL_PROVIDER?.trim() === 'anthropic') {
    problems.push(
      "CODING_MODEL_PROVIDER=anthropic sends the coding expert's model calls to Anthropic, outside mainland China. Use deepseek (the default here), or point CODING_BASE_URL at an Anthropic-format endpoint in the region.",
    );
  }

  const defaultProvider = env.DEFAULT_AGENT_CONFIG?.match(/provider=([^;]+)/)?.[1]?.trim();
  if (defaultProvider && !isModelProviderAvailable(region, defaultProvider)) {
    problems.push(
      `DEFAULT_AGENT_CONFIG makes ${defaultProvider} the default provider, which the mainland edition does not offer. Pick one from MAINLAND_MODEL_PROVIDERS, e.g. provider=deepseek.`,
    );
  }

  // System tasks (topic titles, task briefs, proactive messages) default to an OpenAI model
  const systemAgentPairs = (env.SYSTEM_AGENT ?? '')
    .replaceAll('，', ',')
    .split(',')
    .map((pair) => pair.split('=').map((part) => part.trim()))
    .filter((pair) => pair.length === 2 && pair[0] && pair[1]);
  if (!systemAgentPairs.some(([key]) => key === 'default')) {
    problems.push(
      'SYSTEM_AGENT has no default, so system tasks (topic titles, task briefs, messages Biber sends on its own) use OpenAI, which the mainland edition does not offer. Set e.g. SYSTEM_AGENT=default=deepseek/deepseek-chat.',
    );
  }
  for (const [key, value] of systemAgentPairs) {
    const provider = value.split('/')[0];
    if (!isModelProviderAvailable(region, provider)) {
      problems.push(
        `SYSTEM_AGENT gives ${key} to ${provider}, which the mainland edition does not offer. Pick one from MAINLAND_MODEL_PROVIDERS, e.g. ${key}=deepseek/deepseek-chat.`,
      );
    }
  }

  if (env.SANDBOX_PROVIDER?.trim() === 'market') {
    problems.push(
      'SANDBOX_PROVIDER=market runs code and files on LobeHub Market outside mainland China. Use openbot or onlyboxes.',
    );
  }

  return problems;
};

/** Called once at server start; a deployment with problems does not start. */
export const assertRegionDeployment = (env: DeploymentEnv): void => {
  const problems = regionDeploymentProblems(env);
  if (problems.length === 0) return;

  throw new Error(
    `This deployment's configuration does not fit its region:\n- ${problems.join('\n- ')}`,
  );
};
