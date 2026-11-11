import {
  appleProductIdFor,
  type BillingInterval,
  cnyPriceFor,
  creditPeriodAt,
  effectivePlan,
  isEntitledStatus,
  isGranting,
  isPrepaidProvider,
  monthlyCreditsFor,
  needsResync,
  PLAN_CATALOG,
  planForStripeLookupKey,
  planRank,
  prepaidPeriod,
  type PrepaidProvider,
  stripeLookupKeyFor,
} from '@lobechat/billing';
import type { Plans } from '@lobechat/types';
import debug from 'debug';

import { PaymentOrderModel } from '@/database/models/paymentOrder';
import { UserModel } from '@/database/models/user';
import { UserCreditUsageModel } from '@/database/models/userCreditUsage';
import { UserSubscriptionModel } from '@/database/models/userSubscription';
import type { UserSubscriptionItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

import {
  appleAccountToken,
  AppleJwsError,
  AppleSyncError,
  isAppleOffered,
  syncApplePurchases,
} from './apple';
import {
  getAlipay,
  getWechatPay,
  grantingPrepaid,
  isPrepaidOffered,
  newOrderNumber,
  ORDER_TTL_MS,
  orderSubject,
  refreshPrepaidOrder,
  webhookUrl,
} from './mainland';
import { getStripe, isStripeConfigured, isStripeOffered } from './stripe';
import { syncStripeCustomer } from './stripeSync';

const log = debug('lobe-server:billing');

export type BillingErrorCode =
  /** The user already holds a subscription; plans are changed in the provider's portal */
  | 'ALREADY_SUBSCRIBED'
  /** A lower prepaid plan cannot be bought while a higher one is running */
  | 'LOWER_PLAN'
  /** There is nothing to manage: the user never started a purchase */
  | 'NO_CUSTOMER'
  /** The user has no such payment order */
  | 'NO_ORDER'
  /** The plan has no price to buy, in the catalog or at the provider */
  | 'NOT_FOR_SALE'
  /** This deployment does not sell through this provider */
  | 'UNAVAILABLE';

export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

const RESYNC_RETRY_MS = 10 * 60 * 1000;
/** When each stale customer was last re-read, so a provider outage is not retried on every request. */
const resyncAttempts = new Map<string, number>();

const plansPageUrl = (checkout?: 'canceled' | 'success') =>
  `${appEnv.APP_URL}/settings/plans${checkout ? `?checkout=${checkout}` : ''}`;

export interface PlanPrice {
  /** ISO currency code in lower case, as Stripe gives it, e.g. `usd` or `cny` */
  currency: string;
  interval: BillingInterval;
  plan: Plans;
  /** In the currency's smallest unit, e.g. cents */
  unitAmount: number;
}

const PRICE_CACHE_MS = 10 * 60 * 1000;
let priceCache: { fetchedAt: number; prices: PlanPrice[] } | undefined;

/** The mainland edition's prepaid prices, from the catalog. */
const cnyPlanPrices = (): PlanPrice[] =>
  (Object.keys(PLAN_CATALOG) as Plans[]).flatMap((plan) =>
    (['monthly', 'yearly'] as const).flatMap((interval) => {
      const unitAmount = cnyPriceFor(plan, interval);
      return unitAmount ? [{ currency: 'cny', interval, plan, unitAmount }] : [];
    }),
  );

/**
 * What each paid plan costs. Stripe's prices are read by the catalog's lookup keys so they are
 * set in one place, and cached for ten minutes; the mainland edition's prepaid prices come from
 * the catalog. Empty where neither sells.
 */
export const listPlanPrices = async (now = Date.now()): Promise<PlanPrice[]> => {
  if (isPrepaidOffered('wechat') || isPrepaidOffered('alipay')) return cnyPlanPrices();
  if (!isStripeOffered()) return [];
  if (priceCache && now - priceCache.fetchedAt < PRICE_CACHE_MS) return priceCache.prices;

  const lookupKeys = Object.values(PLAN_CATALOG).flatMap((plan) =>
    plan.stripeLookupKeys ? Object.values(plan.stripeLookupKeys) : [],
  );
  const { data } = await getStripe().prices.list({
    active: true,
    limit: lookupKeys.length,
    lookup_keys: lookupKeys,
  });

  const prices = data.flatMap((price) => {
    const sold = planForStripeLookupKey(price.lookup_key);
    return sold && price.unit_amount !== null
      ? [{ currency: price.currency, ...sold, unitAmount: price.unit_amount }]
      : [];
  });
  priceCache = { fetchedAt: now, prices };
  return prices;
};

export class BillingService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly subscriptions: UserSubscriptionModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.subscriptions = new UserSubscriptionModel(db, userId);
  }

  /** The plan the user is on right now. */
  async getPlan(now = new Date()): Promise<Plans> {
    return effectivePlan(await this.currentSubscriptions(now), now);
  }

  async getStatus(now = new Date()) {
    const rows = await this.currentSubscriptions(now);
    const granting = grantingSubscription(rows, now);
    const credits = await this.allowanceFrom(rows, now);

    return {
      /** This month's included credits and what is left of them */
      credits: {
        monthly: credits.monthlyCredits,
        periodEnd: credits.period.end,
        remaining: credits.remainingCredits,
        used: credits.usedCredits,
      },
      plan: effectivePlan(rows, now),
      alipay: {
        /** Whether a period can be bought with Alipay on this deployment (mainland edition) */
        available: isPrepaidOffered('alipay'),
      },
      apple: {
        /** Whether a plan can be bought through the App Store on this deployment */
        available: isAppleOffered(),
      },
      stripe: {
        /** Whether a plan can be bought with Stripe on this deployment */
        available: isStripeOffered(),
        /** Whether there is a Stripe customer to open the billing portal for */
        hasCustomer: rows.some((row) => row.provider === 'stripe'),
      },
      wechat: {
        /** Whether a period can be bought with WeChat Pay on this deployment (mainland edition) */
        available: isPrepaidOffered('wechat'),
      },
      /** The subscription the plan comes from; absent on the free plan */
      subscription: granting && {
        billingInterval: granting.billingInterval,
        cancelAtPeriodEnd: granting.cancelAtPeriodEnd,
        currentPeriodEnd: granting.currentPeriodEnd,
        plan: granting.plan,
        provider: granting.provider,
        status: granting.status,
      },
    };
  }

  /**
   * What the user may still spend on platform-paid model calls this month. The month runs from
   * the paying subscription's period start, or from account creation on the free plan.
   */
  async getAllowance(now = new Date()) {
    return this.allowanceFrom(await this.currentSubscriptions(now), now);
  }

  /** Counts credits spent on a platform-paid call against the current month. */
  async chargeCredits(credits: number, now = new Date()) {
    if (credits <= 0) return;

    const { period } = await this.allowanceFrom(await this.currentSubscriptions(now), now, false);
    await new UserCreditUsageModel(this.db, this.userId).add(period, credits);
  }

  /** Stripe Checkout for a new subscription; the user pays there and returns to the plans page. */
  async createCheckoutUrl({ interval, plan }: { interval: BillingInterval; plan: Plans }) {
    this.requireStripe();

    const lookupKey = stripeLookupKeyFor(plan, interval);
    if (!lookupKey) throw new BillingError('NOT_FOR_SALE', `The ${plan} plan cannot be bought`);

    const stripe = getStripe();
    const { data: prices } = await stripe.prices.list({
      active: true,
      limit: 1,
      lookup_keys: [lookupKey],
    });
    if (prices.length === 0) {
      throw new BillingError('NOT_FOR_SALE', `Stripe has no active price "${lookupKey}"`);
    }

    const customer = await this.ensureStripeCustomer();
    if (isEntitledStatus(customer.status)) {
      throw new BillingError(
        'ALREADY_SUBSCRIBED',
        'There is already a subscription; change or cancel it in the billing portal',
      );
    }

    const session = await stripe.checkout.sessions.create({
      allow_promotion_codes: true,
      cancel_url: plansPageUrl('canceled'),
      client_reference_id: this.userId,
      customer: customer.providerCustomerId,
      line_items: [{ price: prices[0].id, quantity: 1 }],
      mode: 'subscription',
      success_url: plansPageUrl('success'),
    });
    if (!session.url) throw new Error('Stripe returned a checkout session without a URL');

    return session.url;
  }

  /**
   * Starts paying for a prepaid period (mainland edition): with WeChat Pay the user scans the
   * returned QR code link, with Alipay they go to the returned cashier page. Either way the plan
   * changes once the provider confirms the payment.
   */
  async createPrepaidOrder({
    interval,
    plan,
    provider,
  }: {
    interval: BillingInterval;
    plan: Plans;
    provider: PrepaidProvider;
  }) {
    if (!isPrepaidOffered(provider)) {
      throw new BillingError('UNAVAILABLE', `${provider} is not available on this deployment`);
    }
    const amount = cnyPriceFor(plan, interval);
    if (!amount) throw new BillingError('NOT_FOR_SALE', `The ${plan} plan cannot be bought`);

    const now = new Date();
    const rows = await this.subscriptions.list();
    // An App Store subscription renews by itself: a prepaid period on top would be paid twice
    if (rows.some((row) => !isPrepaidProvider(row.provider) && isGranting(row, now))) {
      throw new BillingError(
        'ALREADY_SUBSCRIBED',
        'There is already a subscription; manage or cancel it where it was bought',
      );
    }
    const current = grantingPrepaid(rows, now);
    if (!prepaidPeriod({ current, interval, paidAt: now, plan }).ok) {
      throw new BillingError(
        'LOWER_PLAN',
        `The ${plan} plan can be bought once the ${current?.plan} plan ends`,
      );
    }

    const orders = new PaymentOrderModel(this.db, this.userId);
    const order = await orders.create({
      amount,
      billingInterval: interval,
      outTradeNo: newOrderNumber(now),
      plan,
      provider,
    });
    const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);
    const subject = orderSubject(plan, interval);

    try {
      if (provider === 'wechat') {
        const codeUrl = await getWechatPay().createNativeOrder({
          amount,
          description: subject,
          expiresAt,
          notifyUrl: webhookUrl('wechat'),
          outTradeNo: order.outTradeNo,
        });
        return { amount, codeUrl, expiresAt, orderId: order.id, provider };
      }

      const payUrl = getAlipay().pagePayUrl({
        amount,
        expiresAt,
        notifyUrl: webhookUrl('alipay'),
        outTradeNo: order.outTradeNo,
        returnUrl: `${plansPageUrl()}?order=${order.id}`,
        subject,
      });
      return { amount, expiresAt, orderId: order.id, payUrl, provider };
    } catch (error) {
      await orders.close(order.id);
      throw error;
    }
  }

  /**
   * A prepaid order and whether it is paid yet. A pending one is read from its provider first, so
   * the page waiting for the payment sees it even when the notification is late.
   */
  async getPrepaidOrder(orderId: string) {
    const orders = new PaymentOrderModel(this.db, this.userId);
    const order = await orders.findById(orderId);
    if (!order) throw new BillingError('NO_ORDER', 'There is no such order');

    await refreshPrepaidOrder(this.db, order);
    const fresh = (await orders.findById(orderId)) ?? order;
    return {
      amount: fresh.amount,
      interval: fresh.billingInterval,
      paidAt: fresh.paidAt,
      plan: fresh.plan,
      provider: fresh.provider,
      status: fresh.status,
    };
  }

  /** Stripe's billing portal: change plan, update the card, cancel, download invoices. */
  async createPortalUrl() {
    this.requireStripe();

    const customer = await this.subscriptions.findByProvider('stripe');
    if (!customer) throw new BillingError('NO_CUSTOMER', 'There is no billing account to manage');

    const session = await getStripe().billingPortal.sessions.create({
      customer: customer.providerCustomerId,
      return_url: plansPageUrl(),
    });
    return session.url;
  }

  /** The paid plans the phone app sells, by App Store product id. */
  appleProducts() {
    const products = Object.entries(PLAN_CATALOG).flatMap(([plan, definition]) =>
      (['monthly', 'yearly'] as const).flatMap((interval) => {
        const productId = appleProductIdFor(plan as Plans, interval);
        return productId
          ? [
              {
                interval,
                monthlyCredits: definition.monthlyCredits,
                plan: plan as Plans,
                productId,
              },
            ]
          : [];
      }),
    );
    return { available: isAppleOffered(), products };
  }

  /** The token the phone attaches to App Store purchases so they come back to this user. */
  async appleAccountToken() {
    this.requireApple();
    return appleAccountToken(this.db, this.userId);
  }

  /** Records the App Store purchases the phone reports (after buying or restoring). */
  async syncApplePurchases(signedTransactions: string[]) {
    this.requireApple();
    try {
      await syncApplePurchases(this.db, this.userId, signedTransactions);
    } catch (error) {
      if (error instanceof AppleSyncError) {
        throw new BillingError(
          error.code === 'CONFLICT' ? 'ALREADY_SUBSCRIBED' : 'NOT_FOR_SALE',
          error.message,
        );
      }
      if (error instanceof AppleJwsError) {
        throw new BillingError('NOT_FOR_SALE', `Not a valid App Store purchase: ${error.message}`);
      }
      throw error;
    }
    return this.getStatus();
  }

  /**
   * Re-reads the user's subscription from Stripe now. The page a user returns to from Checkout
   * calls this, so the new plan shows without waiting for the webhook.
   */
  async refresh() {
    const customer = await this.subscriptions.findByProvider('stripe');
    if (customer && isStripeConfigured()) {
      await syncStripeCustomer(this.db, customer.providerCustomerId);
    }

    return this.getStatus();
  }

  private async allowanceFrom(rows: UserSubscriptionItem[], now = new Date(), withUsage = true) {
    const plan = effectivePlan(rows, now);
    const anchor = grantingSubscription(rows, now)?.currentPeriodStart ?? (await this.signedUpAt());
    const period = creditPeriodAt(anchor, now);
    const monthlyCredits = monthlyCreditsFor(plan);
    const usedCredits = withUsage
      ? await new UserCreditUsageModel(this.db, this.userId).getUsed(period.start)
      : 0;

    return {
      monthlyCredits,
      period,
      plan,
      remainingCredits: Math.max(0, monthlyCredits - usedCredits),
      usedCredits,
    };
  }

  private async signedUpAt() {
    const user = await UserModel.findById(this.db, this.userId);
    return user?.createdAt ?? new Date(0);
  }

  private requireApple() {
    if (!isAppleOffered()) {
      throw new BillingError('UNAVAILABLE', 'The App Store is not available on this deployment');
    }
  }

  private requireStripe() {
    if (!isStripeOffered()) {
      throw new BillingError('UNAVAILABLE', 'Stripe is not available on this deployment');
    }
  }

  private async ensureStripeCustomer() {
    const existing = await this.subscriptions.findByProvider('stripe');
    if (existing) return existing;

    const user = await UserModel.findById(this.db, this.userId);
    const customer = await getStripe().customers.create(
      { email: user?.email ?? undefined, metadata: { userId: this.userId } },
      // Two requests racing here get the same customer back instead of creating two
      { idempotencyKey: `biber-customer-${this.userId}` },
    );

    return this.subscriptions.linkCustomer('stripe', customer.id);
  }

  /**
   * The user's subscriptions, after re-reading from the provider any that still grants a plan
   * past its paid period: that is what a missed renewal or cancellation event looks like. If the
   * provider cannot be reached, what we hold stands.
   */
  private async currentSubscriptions(now = new Date()) {
    const rows = await this.subscriptions.list();
    if (!isStripeConfigured()) return rows;

    const stale = rows.find(
      (row) =>
        row.provider === 'stripe' &&
        needsResync(row, now) &&
        now.getTime() - (resyncAttempts.get(row.providerCustomerId) ?? 0) >= RESYNC_RETRY_MS,
    );
    if (!stale) return rows;

    resyncAttempts.set(stale.providerCustomerId, now.getTime());
    try {
      await syncStripeCustomer(this.db, stale.providerCustomerId);
      resyncAttempts.delete(stale.providerCustomerId);
      return await this.subscriptions.list();
    } catch (error) {
      log('re-reading stale customer %s failed: %O', stale.providerCustomerId, error);
      return rows;
    }
  }
}

/** The subscription the plan comes from: the highest plan among those that grant one now. */
const grantingSubscription = (rows: UserSubscriptionItem[], now: Date) =>
  rows.filter((row) => isGranting(row, now)).sort((a, b) => planRank(b.plan) - planRank(a.plan))[0];
