import { defaultSandboxProviderForRegion } from '@lobechat/region';

import { regionEnv } from '@/envs/region';
import { sandboxEnv } from '@/envs/sandbox';

import { MarketSandboxProvider } from './providers/market';
import { OnlyboxesSandboxProvider } from './providers/onlyboxes';
import { OpenBotSandboxProvider } from './providers/openbot';
import { SandboxMiddlewareService } from './service';
import type {
  SandboxProvider,
  SandboxProviderKind,
  SandboxService,
  SandboxServiceOptions,
} from './types';

export const getSandboxProviderKind = (): SandboxProviderKind => {
  return sandboxEnv.SANDBOX_PROVIDER || defaultSandboxProviderForRegion(regionEnv.APP_REGION);
};

const createSandboxProvider = (options: SandboxServiceOptions): SandboxProvider => {
  switch (getSandboxProviderKind()) {
    case 'onlyboxes': {
      return new OnlyboxesSandboxProvider(options);
    }

    case 'openbot': {
      return new OpenBotSandboxProvider(options);
    }

    case 'market': {
      return new MarketSandboxProvider(options);
    }
  }
};

export const createSandboxService = (options: SandboxServiceOptions): SandboxService => {
  return new SandboxMiddlewareService(createSandboxProvider(options), options);
};
