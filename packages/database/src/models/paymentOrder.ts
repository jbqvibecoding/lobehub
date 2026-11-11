import type { BillingInterval, PrepaidProvider } from '@lobechat/billing';
import type { Plans } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { paymentOrders } from '../schemas/billing';
import type { LobeChatDatabase, Transaction } from '../type';

type Db = LobeChatDatabase | Transaction;

export class PaymentOrderModel {
  private readonly userId: string;
  private readonly db: Db;

  constructor(db: Db, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async create(order: {
    amount: number;
    billingInterval: BillingInterval;
    outTradeNo: string;
    plan: Plans;
    provider: PrepaidProvider;
  }) {
    const [row] = await this.db
      .insert(paymentOrders)
      .values({ ...order, userId: this.userId })
      .returning();
    return row;
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.id, id), eq(paymentOrders.userId, this.userId)))
      .limit(1);
    return row;
  }

  /** Payment notifications name our order number, not the user. */
  static async findByOutTradeNo(db: Db, outTradeNo: string) {
    const [row] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.outTradeNo, outTradeNo))
      .limit(1);
    return row;
  }

  /**
   * Marks an order paid and returns it; returns nothing when it was already paid, so a payment the
   * provider reports twice is applied once. A closed order that was paid after all counts too:
   * the money arrived.
   */
  static async markPaid(
    db: Db,
    outTradeNo: string,
    payment: { paidAt: Date; providerTransactionId: string },
  ) {
    const [row] = await db
      .update(paymentOrders)
      .set({ ...payment, status: 'paid', updatedAt: new Date() })
      .where(
        and(
          eq(paymentOrders.outTradeNo, outTradeNo),
          inArray(paymentOrders.status, ['closed', 'pending']),
        ),
      )
      .returning();
    return row;
  }

  /** Gives up on a pending order, e.g. when the provider would not take it. */
  async close(id: string) {
    await this.db
      .update(paymentOrders)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(
        and(
          eq(paymentOrders.id, id),
          eq(paymentOrders.userId, this.userId),
          eq(paymentOrders.status, 'pending'),
        ),
      );
  }
}
