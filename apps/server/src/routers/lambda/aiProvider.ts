import { isOfficialProvider, OFFICIAL_PROVIDER_DISABLE_ERROR } from '@lobechat/business-const';
import { isModelProviderAvailable } from '@lobechat/region';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { regionEnv } from '@/envs/region';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
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
      aiProviderModel: new AiProviderModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      gateKeeper,
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

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
      return ctx.aiInfraRepos.getAiProviderDetail(input.id, KeyVaultsGateKeeper.getUserKeyVaults);
    }),

  getAiProviderList: aiProviderProcedure.query(async ({ ctx }) => {
    return (await ctx.aiInfraRepos.getAiProviderList()).filter((provider) => offered(provider.id));
  }),

  getAiProviderRuntimeState: aiProviderProcedure
    .input(z.object({ isLogin: z.boolean().optional() }))
    .query(async ({ ctx }): Promise<AiProviderRuntimeState> => {
      return offeredRuntimeState(
        await ctx.aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
      );
    }),

  removeAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:delete'))
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
