import { isMainlandRegion, resolveAppRegion } from './region';

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

  if (env.AGENT_RUNTIME_MODE === 'queue' && !env.QSTASH_URL?.trim()) {
    problems.push(
      `AGENT_RUNTIME_MODE=queue sends every agent step through Upstash QStash, which is hosted outside mainland China. Set QSTASH_URL to a QStash-compatible endpoint in the ${region} region, or use AGENT_RUNTIME_MODE=local.`,
    );
  }

  if (env.STRIPE_SECRET_KEY?.trim()) {
    problems.push(
      'STRIPE_SECRET_KEY is set, but Stripe bills the Global edition only. The mainland edition is paid through WeChat Pay and Alipay; remove the Stripe keys.',
    );
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
