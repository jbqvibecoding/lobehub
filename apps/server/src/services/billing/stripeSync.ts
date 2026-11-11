import {
  isEntitledStatus,
  planForStripeLookupKey,
  planRank,
  type SubscriptionStatus,
} from '@lobechat/billing';
import { Plans } from '@lobechat/types';
import debug from 'debug';
import type Stripe from 'stripe';

import {
  type ProviderSubscriptionSnapshot,
  UserSubscriptionModel,
} from '@/database/models/userSubscription';
import type { LobeChatDatabase } from '@/database/type';
import { billingEnv } from '@/envs/billing';

import { getStripe } from './stripe';

const log = debug('lobe-server:billing:stripe');

const NO_SUBSCRIPTION: ProviderSubscriptionSnapshot = {
  billingInterval: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  currentPeriodStart: null,
  plan: Plans.Free,
  providerSubscriptionId: null,
  status: null,
};

const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

/** Our copy of one Stripe subscription. A price the catalog does not know grants nothing. */
export const snapshotFromStripeSubscription = (
  subscription: Stripe.Subscription,
): ProviderSubscriptionSnapshot => {
  const price = subscription.items.data[0]?.price;
  const sold = planForStripeLookupKey(price?.lookup_key);

  if (!sold) {
    // console (not debug): someone is paying for a price we cannot map to a plan
    console.error(
      `[billing] Stripe subscription ${subscription.id} has a price outside the plan catalog (price=${price?.id}, lookup_key=${price?.lookup_key})`,
    );
  }

  return {
    billingInterval: sold?.interval ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: toDate(subscription.current_period_end),
    currentPeriodStart: toDate(subscription.current_period_start),
    plan: sold?.plan ?? Plans.Free,
    providerSubscriptionId: subscription.id,
    status: subscription.status as SubscriptionStatus,
  };
};

/**
 * The subscription that decides what the customer has: the highest plan among those that
 * currently grant one, otherwise the newest (Stripe lists newest first).
 */
const pickSubscription = (snapshots: ProviderSubscriptionSnapshot[]) =>
  snapshots
    .filter((snapshot) => isEntitledStatus(snapshot.status))
    .sort((a, b) => planRank(b.plan) - planRank(a.plan))[0] ?? snapshots[0];

/**
 * Rewrites what we hold about a Stripe customer from Stripe itself. Every webhook event and
 * every refresh goes through here, so events may arrive late, twice or out of order: the result
 * is always Stripe's current state.
 */
export const syncStripeCustomer = async (db: LobeChatDatabase, customerId: string) => {
  const { data } = await getStripe().subscriptions.list({
    customer: customerId,
    limit: 10,
    status: 'all',
  });
  const snapshot = pickSubscription(data.map(snapshotFromStripeSubscription)) ?? NO_SUBSCRIPTION;

  const row = await UserSubscriptionModel.applyProviderSnapshot(db, 'stripe', customerId, snapshot);
  if (!row) {
    // console (not debug): a customer pays or changed, and we cannot tell which user it is
    console.error(`[billing] Stripe customer ${customerId} is not linked to any user`);
    return undefined;
  }

  log('synced %s: plan=%s status=%s', customerId, row.plan, row.status);
  return row;
};

/** Events after which a customer's subscription may differ from what we hold. */
const SUBSCRIPTION_EVENTS = new Set<string>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.resumed',
  'customer.subscription.updated',
  'invoice.marked_uncollectible',
  'invoice.paid',
  'invoice.payment_action_required',
  'invoice.payment_failed',
]);

const customerIdOf = (event: Stripe.Event): string | undefined => {
  const customer = (event.data.object as { customer?: string | { id: string } | null }).customer;
  return typeof customer === 'string' ? customer : customer?.id;
};

/**
 * Verifies that Stripe sent the payload, then syncs the customer it concerns. Throws on a bad
 * signature and on a failed sync, so the route answers with an error and Stripe retries.
 */
export const handleStripeWebhook = async (
  db: LobeChatDatabase,
  payload: string,
  signature: string,
): Promise<{ handled: boolean; type: string }> => {
  if (!billingEnv.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');

  const event = getStripe().webhooks.constructEvent(
    payload,
    signature,
    billingEnv.STRIPE_WEBHOOK_SECRET,
  );

  const customerId = SUBSCRIPTION_EVENTS.has(event.type) ? customerIdOf(event) : undefined;
  if (!customerId) return { handled: false, type: event.type };

  await syncStripeCustomer(db, customerId);
  return { handled: true, type: event.type };
};
