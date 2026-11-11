// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { userSubscriptions } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserSubscriptionModel } from '@/database/models/userSubscription';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { BillingService } from '../index';
import type * as StripeModule from '../stripe';
import { handleStripeWebhook } from '../stripeSync';

const WEBHOOK_SECRET = 'whsec_test_secret';
// A real client, used only for what works offline: signing and verifying webhook payloads
const offlineStripe = new Stripe('sk_test_offline');

const { env, stripe } = vi.hoisted(() => ({
  env: {
    billing: {
      STRIPE_SECRET_KEY: 'sk_test_offline' as string | undefined,
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' as string | undefined,
    },
    region: { APP_REGION: 'global' },
  },
  stripe: {
    billingPortal: { sessions: { create: vi.fn() } },
    checkout: { sessions: { create: vi.fn() } },
    customers: { create: vi.fn() },
    prices: { list: vi.fn() },
    subscriptions: { list: vi.fn() },
    webhooks: undefined as unknown as Stripe['webhooks'],
  },
}));

vi.mock('@/envs/billing', () => ({ billingEnv: env.billing }));
vi.mock('@/envs/region', () => ({ regionEnv: env.region }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.biber.test' } }));
vi.mock('../stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof StripeModule>()),
  getStripe: () => stripe,
}));

const DAY = 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  cancel_at_period_end: false,
  current_period_end: nowSeconds() + 20 * DAY,
  current_period_start: nowSeconds() - 10 * DAY,
  id: 'sub_1',
  items: { data: [{ price: { id: 'price_1', lookup_key: 'biber_premium_monthly' } }] },
  status: 'active',
  ...overrides,
});

const signedEvent = (type: string, object: Record<string, unknown>) => {
  const payload = JSON.stringify({ data: { object }, id: 'evt_1', object: 'event', type });
  const signature = offlineStripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
};

let db: LobeChatDatabase;
let userId: string;
/** A Stripe customer belongs to one user, so each test's user gets their own */
let customerId: string;

afterEach(async () => {
  await cleanupTestUser(db, userId);
});

beforeEach(async () => {
  db = await getTestDB();
  userId = await createTestUser(db);
  customerId = `cus_${userId}`;
  vi.clearAllMocks();
  stripe.webhooks = offlineStripe.webhooks;
  env.billing.STRIPE_SECRET_KEY = 'sk_test_offline';
  env.region.APP_REGION = 'global';
  stripe.subscriptions.list.mockResolvedValue({ data: [] });
});

describe('buying a plan', () => {
  beforeEach(() => {
    stripe.prices.list.mockResolvedValue({ data: [{ id: 'price_premium_m' }] });
    stripe.customers.create.mockResolvedValue({ id: 'cus_new' });
    stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.test/c1' });
  });

  it('opens Stripe Checkout for the price that sells the plan, as the same customer every time', async () => {
    const service = new BillingService(db, userId);

    const url = await service.createCheckoutUrl({ interval: 'monthly', plan: Plans.Premium });
    await service.createCheckoutUrl({ interval: 'monthly', plan: Plans.Premium });

    expect(url).toBe('https://checkout.stripe.test/c1');
    expect(stripe.prices.list).toHaveBeenCalledWith(
      expect.objectContaining({ lookup_keys: ['biber_premium_monthly'] }),
    );
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.create).toHaveBeenLastCalledWith({
      allow_promotion_codes: true,
      cancel_url: 'https://app.biber.test/settings/plans?checkout=canceled',
      client_reference_id: userId,
      customer: 'cus_new',
      line_items: [{ price: 'price_premium_m', quantity: 1 }],
      mode: 'subscription',
      success_url: 'https://app.biber.test/settings/plans?checkout=success',
    });
  });

  it('does not sell a second subscription to someone who has one', async () => {
    await new UserSubscriptionModel(db, userId).linkCustomer('stripe', customerId);
    stripe.subscriptions.list.mockResolvedValue({ data: [stripeSubscription()] });
    const service = new BillingService(db, userId);
    await service.refresh();

    await expect(
      service.createCheckoutUrl({ interval: 'yearly', plan: Plans.Ultimate }),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED' });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('refuses plans without a price, and deployments that do not sell through Stripe', async () => {
    const service = new BillingService(db, userId);

    await expect(
      service.createCheckoutUrl({ interval: 'monthly', plan: Plans.Free }),
    ).rejects.toMatchObject({ code: 'NOT_FOR_SALE' });

    stripe.prices.list.mockResolvedValue({ data: [] });
    await expect(
      service.createCheckoutUrl({ interval: 'monthly', plan: Plans.Starter }),
    ).rejects.toMatchObject({ code: 'NOT_FOR_SALE' });

    env.region.APP_REGION = 'cn';
    await expect(
      service.createCheckoutUrl({ interval: 'monthly', plan: Plans.Starter }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(service.createPortalUrl()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it('opens the billing portal only for someone who has a customer', async () => {
    const service = new BillingService(db, userId);
    await expect(service.createPortalUrl()).rejects.toMatchObject({ code: 'NO_CUSTOMER' });

    await new UserSubscriptionModel(db, userId).linkCustomer('stripe', customerId);
    stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test' });

    await expect(service.createPortalUrl()).resolves.toBe('https://billing.stripe.test');
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: customerId,
      return_url: 'https://app.biber.test/settings/plans',
    });
  });
});

describe('Stripe webhook', () => {
  beforeEach(async () => {
    await new UserSubscriptionModel(db, userId).linkCustomer('stripe', customerId);
  });

  it('puts the user on the plan Stripe reports, whatever the event said', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [stripeSubscription()] });
    const { payload, signature } = signedEvent('customer.subscription.updated', {
      customer: customerId,
      status: 'canceled',
    });

    await expect(handleStripeWebhook(db, payload, signature)).resolves.toEqual({
      handled: true,
      type: 'customer.subscription.updated',
    });

    const service = new BillingService(db, userId);
    expect(await service.getPlan()).toBe(Plans.Premium);
    expect(await service.getStatus()).toMatchObject({
      plan: Plans.Premium,
      stripe: { available: true, hasCustomer: true },
      subscription: {
        billingInterval: 'monthly',
        cancelAtPeriodEnd: false,
        provider: 'stripe',
        status: 'active',
      },
    });
  });

  it('returns the user to the free plan when the subscription ended', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [stripeSubscription()] });
    const service = new BillingService(db, userId);
    await service.refresh();

    stripe.subscriptions.list.mockResolvedValue({
      data: [stripeSubscription({ status: 'canceled' })],
    });
    const { payload, signature } = signedEvent('customer.subscription.deleted', {
      customer: { id: customerId },
    });
    await handleStripeWebhook(db, payload, signature);

    expect(await service.getStatus()).toMatchObject({ plan: Plans.Free, subscription: undefined });
  });

  it('grants nothing for a price outside the catalog', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stripe.subscriptions.list.mockResolvedValue({
      data: [
        stripeSubscription({ items: { data: [{ price: { id: 'p', lookup_key: 'other_app' } }] } }),
      ],
    });
    const { payload, signature } = signedEvent('invoice.paid', { customer: customerId });

    await handleStripeWebhook(db, payload, signature);

    expect(await new BillingService(db, userId).getPlan()).toBe(Plans.Free);
  });

  it('rejects a payload Stripe did not sign, and changes nothing', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [stripeSubscription()] });
    const { payload } = signedEvent('customer.subscription.updated', { customer: customerId });
    const forged = offlineStripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_someone_else',
    });

    await expect(handleStripeWebhook(db, payload, forged)).rejects.toThrow(/signature/i);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(await new BillingService(db, userId).getPlan()).toBe(Plans.Free);
  });

  it('ignores events that do not concern a subscription', async () => {
    const { payload, signature } = signedEvent('product.updated', { id: 'prod_1' });

    await expect(handleStripeWebhook(db, payload, signature)).resolves.toEqual({
      handled: false,
      type: 'product.updated',
    });
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });
});

describe('a missed provider event', () => {
  const endedYesterday = () => new Date(Date.now() - DAY * 1000);

  const holdStalePremium = async () => {
    await new UserSubscriptionModel(db, userId).linkCustomer('stripe', customerId);
    await db
      .update(userSubscriptions)
      .set({ currentPeriodEnd: endedYesterday(), plan: Plans.Premium, status: 'active' })
      .where(eq(userSubscriptions.userId, userId));
  };

  it('is caught on the next read: a plan past its paid period is checked with Stripe', async () => {
    await holdStalePremium();
    stripe.subscriptions.list.mockResolvedValue({
      data: [stripeSubscription({ status: 'canceled' })],
    });

    expect(await new BillingService(db, userId).getPlan()).toBe(Plans.Free);
  });

  it('keeps what we hold while Stripe cannot be reached, without asking on every read', async () => {
    await holdStalePremium();
    stripe.subscriptions.list.mockRejectedValue(new Error('Stripe is down'));
    const service = new BillingService(db, userId);

    expect(await service.getPlan()).toBe(Plans.Premium);
    expect(await service.getPlan()).toBe(Plans.Premium);
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(1);
  });
});
