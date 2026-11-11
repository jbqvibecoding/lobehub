// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { ChatErrorType, Plans } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import { UserCreditUsageModel } from '@/database/models/userCreditUsage';
import { UserSubscriptionModel } from '@/database/models/userSubscription';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { createCreditHooks, creditsForUsage } from '../creditHooks';
import { BillingService } from '../index';

const { env } = vi.hoisted(() => ({
  env: {
    billing: { STRIPE_SECRET_KEY: 'sk_test_offline' as string | undefined },
    region: { APP_REGION: 'global' },
  },
}));

let db: LobeChatDatabase;
let userId: string;

vi.mock('@/envs/billing', () => ({ billingEnv: env.billing }));
vi.mock('@/envs/region', () => ({ regionEnv: env.region }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => db) }));

const chat = { messages: [], model: 'gpt-x', temperature: 1 } as any;

beforeEach(async () => {
  db = await getTestDB();
  userId = await createTestUser(db);
  env.billing.STRIPE_SECRET_KEY = 'sk_test_offline';
  env.region.APP_REGION = 'global';
});

afterEach(async () => {
  await cleanupTestUser(db, userId);
  vi.restoreAllMocks();
});

const spend = async (credits: number) => {
  const { period } = await new BillingService(db, userId).getAllowance();
  await new UserCreditUsageModel(db, userId).add(period, credits);
};

describe('credit hooks', () => {
  it('lets calls through while credits remain, then refuses with the free-plan limit', async () => {
    const hooks = createCreditHooks(userId, 'openai');
    await expect(hooks.beforeChat!(chat)).resolves.toBeUndefined();

    await spend(500_000);

    await expect(hooks.beforeChat!(chat)).rejects.toMatchObject({
      budget: { planAtError: Plans.Free },
      errorType: ChatErrorType.FreePlanLimit,
      provider: 'openai',
    });
    await expect(hooks.beforeGenerateObject!({} as any)).rejects.toMatchObject({
      errorType: ChatErrorType.FreePlanLimit,
    });
  });

  it("refuses with the subscription limit once a paid plan's credits are used", async () => {
    await new UserSubscriptionModel(db, userId).linkCustomer('stripe', `cus_${userId}`);
    await UserSubscriptionModel.applyProviderSnapshot(db, 'stripe', `cus_${userId}`, {
      billingInterval: 'monthly',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
      currentPeriodStart: new Date(Date.now() - 10 * 86_400_000),
      plan: Plans.Starter,
      providerSubscriptionId: 'sub_1',
      status: 'active',
    });
    const hooks = createCreditHooks(userId, 'openai');

    await spend(4_999_999);
    await expect(hooks.beforeChat!(chat)).resolves.toBeUndefined();

    await spend(1);
    await expect(hooks.beforeChat!(chat)).rejects.toMatchObject({
      errorType: ChatErrorType.SubscriptionPlanLimit,
    });
  });

  it('charges each finished call its cost, rounded up to whole credits', async () => {
    const hooks = createCreditHooks(userId, 'openai');

    await hooks.onChatFinal!({ text: 'hi', usage: { cost: 0.0123451 } as any }, { payload: chat });
    await hooks.onGenerateObjectFinal!({ usage: { cost: 0.000_000_1 } as any }, { payload: chat });

    expect(await new BillingService(db, userId).getAllowance()).toMatchObject({
      remainingCredits: 500_000 - 12_346 - 1,
      usedCredits: 12_347,
    });
  });

  it('does not charge a call whose model has no price, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hooks = createCreditHooks(userId, 'openai');

    await hooks.onChatFinal!({ text: 'hi', usage: { totalTokens: 900 } as any }, { payload: chat });

    expect((await new BillingService(db, userId).getAllowance()).usedCredits).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('openai/gpt-x'));
    expect(creditsForUsage(undefined)).toBeUndefined();
  });

  it('keeps the reply when the charge cannot be written', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(BillingService.prototype, 'chargeCredits').mockRejectedValue(new Error('db down'));
    const hooks = createCreditHooks(userId, 'openai');

    await expect(
      hooks.onChatFinal!({ text: 'hi', usage: { cost: 0.01 } as any }, { payload: chat }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe('which calls are metered', () => {
  it('only platform-paid calls, and only where plans can be bought', () => {
    expect(
      getBusinessModelRuntimeHooks(userId, 'openai', undefined, { platformPaid: true }),
    ).toEqual(expect.objectContaining({ beforeChat: expect.any(Function) }));
    expect(getBusinessModelRuntimeHooks(userId, 'openai', undefined, { platformPaid: false })).toBe(
      undefined,
    );
    expect(getBusinessModelRuntimeHooks(userId, 'lobehub')).toBeUndefined();

    env.region.APP_REGION = 'cn';
    expect(
      getBusinessModelRuntimeHooks(userId, 'openai', undefined, { platformPaid: true }),
    ).toBeUndefined();

    env.region.APP_REGION = 'global';
    env.billing.STRIPE_SECRET_KEY = undefined;
    expect(
      getBusinessModelRuntimeHooks(userId, 'openai', undefined, { platformPaid: true }),
    ).toBeUndefined();
  });
});
