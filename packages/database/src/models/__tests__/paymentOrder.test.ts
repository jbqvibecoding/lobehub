import { Plans } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { PaymentOrderModel } from '../../models/paymentOrder';
import { paymentOrders } from '../../schemas/billing';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'payment-order-user';
const otherUserId = 'payment-order-other-user';

const order = (outTradeNo: string) => ({
  amount: 6800,
  billingInterval: 'monthly' as const,
  outTradeNo,
  plan: Plans.Starter,
  provider: 'wechat' as const,
});

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('PaymentOrderModel', () => {
  it("shows a user only their own orders, pending in yuan's smallest unit", async () => {
    const created = await new PaymentOrderModel(serverDB, userId).create(order('pom-1'));

    expect(created).toMatchObject({ amount: 6800, currency: 'CNY', status: 'pending' });
    expect(await new PaymentOrderModel(serverDB, otherUserId).findById(created.id)).toBeUndefined();
    expect(await new PaymentOrderModel(serverDB, userId).findById(created.id)).toMatchObject({
      outTradeNo: 'pom-1',
    });
  });

  it('marks an order paid once, even one that was closed before the money arrived', async () => {
    const model = new PaymentOrderModel(serverDB, userId);
    const created = await model.create(order('pom-2'));
    await model.close(created.id);
    const payment = { paidAt: new Date('2026-11-11T02:00:00Z'), providerTransactionId: 'wx-1' };

    expect(await PaymentOrderModel.markPaid(serverDB, 'pom-2', payment)).toMatchObject({
      paidAt: payment.paidAt,
      status: 'paid',
    });
    expect(await PaymentOrderModel.markPaid(serverDB, 'pom-2', payment)).toBeUndefined();
  });

  it('does not let one user close another user’s order', async () => {
    const created = await new PaymentOrderModel(serverDB, userId).create(order('pom-3'));

    await new PaymentOrderModel(serverDB, otherUserId).close(created.id);

    const [row] = await serverDB
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.id, created.id));
    expect(row.status).toBe('pending');
  });
});
