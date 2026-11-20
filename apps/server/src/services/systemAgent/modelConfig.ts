import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { SystemAgentItem, UserSystemAgentConfigKey } from '@lobechat/types';

interface ResolveSystemAgentModelConfigParams {
  /** The deployment's choice for the task, from the SYSTEM_AGENT environment variable */
  deploymentConfig?: Partial<Pick<SystemAgentItem, 'model' | 'provider'>>;
  override?: Partial<Pick<SystemAgentItem, 'model' | 'provider'>>;
  taskConfig?: Partial<SystemAgentItem>;
  taskKey: UserSystemAgentConfigKey;
}

/**
 * The model for a system task: the caller's override, the user's own setting, the deployment's
 * SYSTEM_AGENT, then the built-in default (which the mainland edition does not offer).
 */
export const resolveSystemAgentModelConfig = async ({
  deploymentConfig,
  override,
  taskConfig,
  taskKey,
}: ResolveSystemAgentModelConfigParams): Promise<{ model: string; provider: string }> => {
  const defaults = DEFAULT_SYSTEM_AGENT_CONFIG[taskKey];
  const model = override?.model || taskConfig?.model || deploymentConfig?.model || defaults.model;
  const provider =
    override?.provider || taskConfig?.provider || deploymentConfig?.provider || defaults.provider;

  return { model, provider };
};
