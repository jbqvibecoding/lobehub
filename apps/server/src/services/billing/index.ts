import {
  type BillingInterval,
  effectivePlan,
  isEntitledStatus,
  needsResync,
  planRank,
  stripeLookupKeyFor,
} from '@lobechat/billing';
import { isPaymentProviderAvailable } from '@lobechat/region';
import type { Plans } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { UserSubscriptionModel } from '@/database/models/userSubscription';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { regionEnv } from '@/envs/region';

import { getStripe, isStripeConfigured } from './stripe';
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

/** Stripe sells here when this deployment has its keys and its edition is billed through Stripe. */
export const isStripeOffered = () =>
  isStripeConfigured() && isPaymentProviderAvailable(regionEnv.APP_REGION, 'stripe');

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
    const granting = rows
      .filter((row) => isEntitledStatus(row.status))
      .sort((a, b) => planRank(b.plan) - planRank(a.plan))[0];

    return {
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
