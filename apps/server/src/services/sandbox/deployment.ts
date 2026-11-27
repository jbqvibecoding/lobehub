import { defaultSandboxProviderForRegion } from '@lobechat/region';

import { regionEnv } from '@/envs/region';
import { sandboxEnv } from '@/envs/sandbox';

import type { SandboxProviderKind } from './types';

/** Unset, the edition picks: Market for Global, Biber's own cloud computers for the mainland. */
export const getSandboxProviderKind = (): SandboxProviderKind =>
  sandboxEnv.SANDBOX_PROVIDER || defaultSandboxProviderForRegion(regionEnv.APP_REGION);

export type SandboxDeployment = 'market' | 'onlyboxes' | 'openbot' | 'unconfigured';

/** The sandbox this deployment runs commands in; `unconfigured` when its provider lacks settings. */
export const getSandboxDeployment = (): SandboxDeployment => {
  const kind = getSandboxProviderKind();
  // Biber's own cloud computers need no Market authorization
  if (kind === 'openbot') {
    return sandboxEnv.OPENBOT_SUPERVISOR_URL && sandboxEnv.OPENBOT_SUPERVISOR_TOKEN
      ? 'openbot'
      : 'unconfigured';
  }
  if (kind !== 'onlyboxes') return 'market';
  return sandboxEnv.ONLYBOXES_BASE_URL && sandboxEnv.ONLYBOXES_JIT_SIGNING_KEY
    ? 'onlyboxes'
    : 'unconfigured';
};
