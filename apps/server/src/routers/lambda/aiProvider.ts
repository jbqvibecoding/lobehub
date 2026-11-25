import { isOfficialProvider, OFFICIAL_PROVIDER_DISABLE_ERROR } from '@lobechat/business-const';
import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import {
  HETEROGENEOUS_PROVIDER_BINDING_AGENT_TYPES,
  type HeterogeneousProviderBindingRuntime,
  resolveHeterogeneousProviderBinding,
} from '@lobechat/heterogeneous-agents';
import { isModelProviderAvailable } from '@lobechat/region';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { regionEnv } from '@/envs/region';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { getUserScopedAiProviderRuntimeState } from '@/server/services/aiProviderAccess';
import { type AiProviderDetailItem, type AiProviderRuntimeState } from '@/types/aiProvider';
import {
  CreateAiProviderSchema,
  UpdateAiProviderConfigSchema,
  UpdateAiProviderSchema,
} from '@/types/aiProvider';
import { type ProviderConfig } from '@/types/user/settings';

/**
 * The mainland edition lists only the model providers it offers (`MAINLAND_MODEL_PROVIDERS`), so
 * settings and model pickers never show one a call would be refused for.
 */
const offered = (provider: string) => isModelProviderAvailable(regionEnv.APP_REGION, provider);

const offeredRuntimeState = (state: AiProviderRuntimeState): AiProviderRuntimeState => ({
  ...state,
  enabledAiModels: state.enabledAiModels.filter((model) => offered(model.providerId)),
  enabledAiProviders: state.enabledAiProviders.filter((provider) => offered(provider.id)),
  enabledChatAiProviders: state.enabledChatAiProviders.filter((provider) => offered(provider.id)),
  enabledImageAiProviders: state.enabledImageAiProviders.filter((provider) => offered(provider.id)),
  enabledVideoAiProviders: state.enabledVideoAiProviders.filter((provider) => offered(provider.id)),
  runtimeConfig: Object.fromEntries(
    Object.entries(state.runtimeConfig).filter(([provider]) => offered(provider)),
  ),
});

const aiProviderProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  const { aiProvider } = await getServerGlobalConfig();

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return opts.next({
    ctx: {
      aiInfraRepos: new AiInfraRepos(
        ctx.serverDB,
        ctx.userId,
        aiProvider as Record<string, ProviderConfig>,
        ctx.workspaceId ?? undefined,
      ),
      aiModelModel: new AiModelModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      aiProviderModel: new AiProviderModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      gateKeeper,
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

const resolveProviderBindingAgentTypes = (
  state: AiProviderRuntimeState,
): Record<string, string[]> =>
  Object.fromEntries(
    state.enabledAiProviders.map(({ id }) => [
      id,
      HETEROGENEOUS_PROVIDER_BINDING_AGENT_TYPES.filter(
        (agentType) =>
          !!resolveHeterogeneousProviderBinding({
            agentType,
            apiConfig: { model: '__capability_probe__', providerId: id },
            providerEnabled: true,
            runtimeConfig: state.runtimeConfig[id],
          }).resolution,
      ),
    ]),
  );

export const aiProviderRouter = router({
  checkProviderConnectivity: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        id: z.string(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Get the provider detail to find checkModel
      const detail = await ctx.aiInfraRepos.getAiProviderDetail(
        input.id,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );

      const model = input.model || detail?.checkModel;
      if (!model) {
        return { error: 'No check model configured. Use --model to specify one.', ok: false };
      }

      try {
        const modelRuntime = await initModelRuntimeFromDB(
          ctx.serverDB,
          ctx.userId,
          input.id,
          ctx.workspaceId ?? undefined,
        );

        const response = await modelRuntime.chat(
          {
            messages: [{ content: 'Hi', role: 'user' }],
            model,
            stream: false,
            temperature: 0,
          },
          {
            metadata: { trigger: RequestTrigger.Api },
          },
        );

        // If we get a response without error, connectivity is ok
        if (response.ok) {
          return { model, ok: true };
        }

        const errorBody = await response.text();
        return { error: errorBody, model, ok: false, status: response.status };
      } catch (error: any) {
        const errorType = error.errorType || error.type;
        const msg =
          errorType ||
          (typeof error === 'string'
            ? error
            : error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error)));
        return { error: msg, model, ok: false };
      }
    }),

  createAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:create'))
    .input(CreateAiProviderSchema)
    .mutation(async ({ input, ctx }) => {
      if (!offered(input.id)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Custom model providers are not offered in this edition',
        });
      }
      try {
        const data = await ctx.aiProviderModel.create(input, ctx.gateKeeper.encrypt);
        return data?.id;
      } catch (error: any) {
        const pgErrorCode = error?.cause?.cause?.code || error?.cause?.code || error?.code;
        if (pgErrorCode === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Provider "${input.id}" already exists`,
          });
        }
        throw error;
      }
    }),

  getAiProviderById: aiProviderProcedure
    .input(z.object({ id: z.string() }))

    .query(async ({ input, ctx }): Promise<AiProviderDetailItem | undefined> => {
      const detail = await ctx.aiInfraRepos.getAiProviderDetail(
        input.id,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );

      // restricted API keys must not exfiltrate decrypted provider credentials
      if (detail && ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes)) {
        return { ...detail, keyVaults: undefined };
      }

      return detail;
    }),

  getAiProviderList: aiProviderProcedure.query(async ({ ctx }) => {
    return (await ctx.aiInfraRepos.getAiProviderList()).filter((provider) => offered(provider.id));
  }),

  getAiProviderRuntimeState: aiProviderProcedure
    .input(z.object({ isLogin: z.boolean().optional() }))
    .query(async ({ ctx }): Promise<AiProviderRuntimeState> => {
      const [scopedState, modelReasoningConfigs] = await Promise.all([
        getUserScopedAiProviderRuntimeState(ctx.userId, () =>
          ctx.aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
        ),
        // Loaded here rather than in the shared runtime-state loader: only the
        // client model list needs it, and server-side callers skip the query
        ctx.aiModelModel.getAllModelReasoningConfigs(),
      ]);
      // Only the providers this edition offers (see `offeredRuntimeState`)
      const state = offeredRuntimeState({ ...scopedState, modelReasoningConfigs });
      const providerBindingAgentTypes = resolveProviderBindingAgentTypes(state);

      // restricted API keys must not exfiltrate decrypted provider credentials
      if (ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes)) {
        return {
          ...state,
          providerBindingAgentTypes,
          runtimeConfig: Object.fromEntries(
            Object.entries(state.runtimeConfig).map(([id, config]) => [
              id,
              { ...config, keyVaults: {} },
            ]),
          ),
        };
      }

      return { ...state, providerBindingAgentTypes };
    }),

  /**
   * Narrow credential-bearing endpoint for Desktop-local heterogeneous-agent
   * bindings. Desktop main calls this with the current OIDC identity and no
   * workspace scope — provider binding is personal-agent/local-execution only
   * (`selectRuntimeType` rejects API-mode runs for workspace agents, even for
   * the author who can spawn them in-process) — and
   * renderer IPC receives only the provider/model reference. `enabledModels`
   * makes Desktop main the authority on model availability instead of the
   * renderer's possibly stale store state.
   */
  getProviderBindingRuntime: aiProviderProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }): Promise<HeterogeneousProviderBindingRuntime> => {
      // Only the providers this edition offers (see `offeredRuntimeState`)
      const state = offeredRuntimeState(
        await getUserScopedAiProviderRuntimeState(ctx.userId, () =>
          ctx.aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
        ),
      );
      const enabled = state.enabledAiProviders.some(({ id }) => id === input.id);
      const runtimeConfig = state.runtimeConfig[input.id];
      const enabledModels = state.enabledAiModels
        .filter((model) => model.providerId === input.id)
        .map(
          ({ abilities, contextWindowTokens, displayName, id, maxOutput, providerId, type }) => ({
            abilities: {
              reasoning: abilities.reasoning,
              vision: abilities.vision,
            },
            contextWindowTokens,
            displayName,
            id,
            maxOutput,
            providerId,
            type,
          }),
        );

      if (ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes)) {
        return {
          enabled,
          enabledModels,
          runtimeConfig: runtimeConfig ? { ...runtimeConfig, keyVaults: {} } : undefined,
        };
      }

      return { enabled, enabledModels, runtimeConfig };
    }),

  // Provider rows carry workspace-shared credentials and the model-layer where is
  // workspace-wide, so destructive/config writes are Admin-or-higher in workspace mode
  // (the workspace provider settings UI is likewise admin-only).
  removeAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:delete'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiProviderModel.delete(input.id);
    }),

  toggleProviderEnabled: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        enabled: z.boolean(),
        id: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (isOfficialProvider(input.id) && input.enabled === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: OFFICIAL_PROVIDER_DISABLE_ERROR,
        });
      }

      return ctx.aiProviderModel.toggleProviderEnabled(input.id, input.enabled);
    }),

  updateAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(
      z.object({
        id: z.string(),
        value: UpdateAiProviderSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiProviderModel.update(input.id, input.value);
    }),

  updateAiProviderConfig: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(
      z.object({
        id: z.string(),
        value: UpdateAiProviderConfigSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiProviderModel.updateConfig(
        input.id,
        input.value,
        ctx.gateKeeper.encrypt,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
    }),

  updateAiProviderOrder: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        sortMap: z.array(
          z.object({
            id: z.string(),
            sort: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiProviderModel.updateOrder(input.sortMap);
    }),
});

export type AiProviderRouter = typeof aiProviderRouter;
