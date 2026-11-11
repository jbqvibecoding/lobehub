import type { SubscriptionProvider } from '@lobechat/billing';
import { and, eq } from 'drizzle-orm';

import type { UserSubscriptionItem } from '../schemas/billing';
import { userSubscriptions } from '../schemas/billing';
import type { LobeChatDatabase, Transaction } from '../type';

type Db = LobeChatDatabase | Transaction;

/** A subscription as its provider reports it; `status: null` means the customer has none. */
export type ProviderSubscriptionSnapshot = Pick<
  UserSubscriptionItem,
  | 'billingInterval'
  | 'cancelAtPeriodEnd'
  | 'currentPeriodEnd'
  | 'currentPeriodStart'
  | 'plan'
  | 'providerSubscriptionId'
  | 'status'
>;

export class UserSubscriptionModel {
  private readonly userId: string;
  private readonly db: Db;

  constructor(db: Db, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(userSubscriptions.userId, this.userId);

  async list() {
    return this.db.select().from(userSubscriptions).where(this.ownership());
  }

  async findByProvider(provider: SubscriptionProvider) {
    const [row] = await this.db
      .select()
      .from(userSubscriptions)
      .where(and(this.ownership(), eq(userSubscriptions.provider, provider)))
      .limit(1);

    return row;
  }

  /**
   * Remembers which customer the user is at a provider. The first link wins: when two requests
   * race, both get the row that was stored, so they go on with the same customer.
   */
  async linkCustomer(provider: SubscriptionProvider, providerCustomerId: string) {
    await this.db
      .insert(userSubscriptions)
      .values({ provider, providerCustomerId, userId: this.userId })
      .onConflictDoNothing({ target: [userSubscriptions.userId, userSubscriptions.provider] });

    return (await this.findByProvider(provider))!;
  }

  /**
   * Stores a period the user paid for in advance through `provider` (WeChat Pay, Alipay). There is
   * no customer at those providers, so the row is keyed by our own user id.
   */
  async savePrepaidPeriod(
    provider: SubscriptionProvider,
    snapshot: ProviderSubscriptionSnapshot,
    syncedAt = new Date(),
  ) {
    const [row] = await this.db
      .insert(userSubscriptions)
      .values({
        ...snapshot,
        provider,
        providerCustomerId: `user:${this.userId}`,
        syncedAt,
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: { ...snapshot, syncedAt, updatedAt: new Date() },
        target: [userSubscriptions.userId, userSubscriptions.provider],
      })
      .returning();

    return row;
  }

  /** Ends what the user holds with a provider, e.g. a prepaid period another one replaced. */
  async endWith(provider: SubscriptionProvider, endedAt = new Date()) {
    await this.db
      .update(userSubscriptions)
      .set({ status: 'canceled', syncedAt: endedAt, updatedAt: new Date() })
      .where(and(this.ownership(), eq(userSubscriptions.provider, provider)));
  }

  /** A provider customer's row, whoever it belongs to; provider events name the customer. */
  static async findByCustomer(
    db: LobeChatDatabase,
    provider: SubscriptionProvider,
    providerCustomerId: string,
  ) {
    const [row] = await db
      .select()
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.provider, provider),
          eq(userSubscriptions.providerCustomerId, providerCustomerId),
        ),
      )
      .limit(1);

    return row;
  }

  /**
   * The row holding a provider subscription, whoever it belongs to. App Store events that carry
   * no account token are matched to their user this way.
   */
  static async findByProviderSubscription(
    db: LobeChatDatabase,
    provider: SubscriptionProvider,
    providerSubscriptionId: string,
  ) {
    const [row] = await db
      .select()
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.provider, provider),
          eq(userSubscriptions.providerSubscriptionId, providerSubscriptionId),
        ),
      )
      .limit(1);

    return row;
  }

  /**
   * Rewrites a customer's row from what the provider reports. Provider events name the customer,
   * not our user, so this is not scoped to one; it returns nothing for a customer we never linked.
   */
  static async applyProviderSnapshot(
    db: LobeChatDatabase,
    provider: SubscriptionProvider,
    providerCustomerId: string,
    snapshot: ProviderSubscriptionSnapshot,
    syncedAt = new Date(),
  ) {
    const [row] = await db
      .update(userSubscriptions)
      .set({ ...snapshot, syncedAt })
      .where(
        and(
          eq(userSubscriptions.provider, provider),
          eq(userSubscriptions.providerCustomerId, providerCustomerId),
        ),
      )
      .returning();

    return row;
  }
}
