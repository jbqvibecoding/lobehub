import {
  type BillingInterval,
  creditPeriodAt,
  effectivePlan,
  isEntitledStatus,
  monthlyCreditsFor,
  needsResync,
  PLAN_CATALOG,
  planForStripeLookupKey,
  planRank,
  stripeLookupKeyFor,
} from '@lobechat/billing';
import type { Plans } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { UserCreditUsageModel } from '@/database/models/userCreditUsage';
import { UserSubscriptionModel } from '@/database/models/userSubscription';
import type { UserSubscriptionItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

import { getStripe, isStripeConfigured, isStripeOffered } from './stripe';
import { syncStripeCustomer } from './stripeSync';

const log = debug('lobe-server:billing');

export type BillingErrorCode =
  /** The user already holds a subscription; plans are changed in the provider's portal */
  | 'ALREADY_SUBSCRIBED'
  /** There is nothing to manage: the user never started a purchase */
  | 'NO_CUSTOMER'
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
  /** ISO currency code in lower case, as Stripe gives it, e.g. `usd` */
  currency: string;
  interval: BillingInterval;
  plan: Plans;
  /** In the currency's smallest unit, e.g. cents */
  unitAmount: number;
}

const PRICE_CACHE_MS = 10 * 60 * 1000;
let priceCache: { fetchedAt: number; prices: PlanPrice[] } | undefined;

/**
 * What each paid plan costs, read from Stripe by the catalog's lookup keys so prices are set in
 * one place. Cached for ten minutes; empty where Stripe does not sell.
 */
export const listPlanPrices = async (now = Date.now()): Promise<PlanPrice[]> => {
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
  async getPlan(): Promise<Plans> {
    return effectivePlan(await this.currentSubscriptions());
  }

  async getStatus() {
    const rows = await this.currentSubscriptions();
    const granting = grantingSubscription(rows);
    const credits = await this.allowanceFrom(rows);

    return {
      /** This month's included credits and what is left of them */
      credits: {
        monthly: credits.monthlyCredits,
        periodEnd: credits.period.end,
        remaining: credits.remainingCredits,
        used: credits.usedCredits,
      },
      plan: effectivePlan(rows),
      stripe: {
        /** Whether a plan can be bought with Stripe on this deployment */
        available: isStripeOffered(),
        /** Whether there is a Stripe customer to open the billing portal for */
        hasCustomer: rows.some((row) => row.provider === 'stripe'),
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
    const plan = effectivePlan(rows);
    const anchor = grantingSubscription(rows)?.currentPeriodStart ?? (await this.signedUpAt());
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

/** The subscription the plan comes from: the highest plan among those that grant one. */
const grantingSubscription = (rows: UserSubscriptionItem[]) =>
  rows
    .filter((row) => isEntitledStatus(row.status))
    .sort((a, b) => planRank(b.plan) - planRank(a.plan))[0];
