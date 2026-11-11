import type { BillingInterval, SubscriptionProvider, SubscriptionStatus } from '@lobechat/billing';
import type { Plans } from '@lobechat/types';
import { bigint, boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

/**
 * User subscriptions - what a user holds with one payment provider: their customer record there
 * and, once they subscribe, a copy of the subscription as the provider last reported it. The
 * provider stays the source of truth; rows are rewritten whole from it on every sync.
 */
export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    provider: text('provider').$type<SubscriptionProvider>().notNull(),
    /** The provider's id for the user as a payer, e.g. Stripe `cus_...`; exists before any purchase */
    providerCustomerId: text('provider_customer_id').notNull(),
    /** e.g. Stripe `sub_...`; null while the customer has never subscribed */
    providerSubscriptionId: text('provider_subscription_id'),

    /** The product's plan key the subscribed price maps to; `free` while there is no subscription */
    plan: text('plan')
      .$type<Plans>()
      .default('free' as Plans)
      .notNull(),
    billingInterval: text('billing_interval').$type<BillingInterval>(),
    /** The provider's lifecycle state, e.g. `active` or `past_due`; null without a subscription */
    status: text('status').$type<SubscriptionStatus>(),

    currentPeriodStart: timestamptz('current_period_start'),
    currentPeriodEnd: timestamptz('current_period_end'),
    /** The user canceled: the plan stays until `currentPeriodEnd`, then the provider ends it */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),

    /** When this row was last rewritten from the provider; drives re-sync of rows that look stale */
    syncedAt: timestamptz('synced_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_subscriptions_user_id_provider_unique').on(t.userId, t.provider),
    /** Provider events name the customer, not the user */
    uniqueIndex('user_subscriptions_provider_customer_id_unique').on(
      t.provider,
      t.providerCustomerId,
    ),
  ],
);

export type NewUserSubscription = typeof userSubscriptions.$inferInsert;
export type UserSubscriptionItem = typeof userSubscriptions.$inferSelect;

/**
 * User credit usages - credits a user spent on platform-paid model calls within one monthly
 * credit window. What remains is the plan's monthly allowance minus `usedCredits`.
 */
export const userCreditUsages = pgTable(
  'user_credit_usages',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Start of the monthly window (inclusive); with the user it identifies the window */
    periodStart: timestamptz('period_start').notNull(),
    periodEnd: timestamptz('period_end').notNull(),

    /** Whole credits; 1,000,000 credits pay for one US dollar of model usage */
    usedCredits: bigint('used_credits', { mode: 'number' }).default(0).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_credit_usages_user_id_period_start_unique').on(t.userId, t.periodStart),
  ],
);

export type NewUserCreditUsage = typeof userCreditUsages.$inferInsert;
export type UserCreditUsageItem = typeof userCreditUsages.$inferSelect;
