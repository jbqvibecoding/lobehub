// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { paymentOrders, userSubscriptions } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserSubscriptionModel } from '@/database/models/userSubscription';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { BillingService, listPlanPrices } from '../../index';
import { signingContent } from '../alipay';
import { applyPaidOrder, handleAlipayNotification, handleWechatPayNotification } from '../index';
import { rsaPair, signWith, wechatEncrypt, wechatHeaders } from './keys';

const merchant = rsaPair();
const platform = rsaPair();
const alipayApp = rsaPair();
const alipayKeys = rsaPair();
const API_V3_KEY = 'abcdefghijklmnopqrstuvwxyz012345';

const { env } = vi.hoisted(() => ({
  env: { billing: {} as Record<string, string>, region: { APP_REGION: 'cn' } },
}));

vi.mock('@/envs/billing', () => ({ billingEnv: env.billing }));
vi.mock('@/envs/region', () => ({ regionEnv: env.region }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.biber.test' } }));

Object.assign(env.billing, {
  ALIPAY_APP_ID: '2021000000000001',
  ALIPAY_PRIVATE_KEY: alipayApp.privateKey,
  ALIPAY_PUBLIC_KEY: alipayKeys.publicKey,
  WECHATPAY_APIV3_KEY: API_V3_KEY,
  WECHATPAY_APPID: 'wx_app',
  WECHATPAY_MCHID: '1900000001',
  WECHATPAY_MERCHANT_SERIAL_NO: 'SERIAL01',
  WECHATPAY_PRIVATE_KEY: merchant.privateKey,
  WECHATPAY_PUBLIC_KEY: platform.publicKey,
  WECHATPAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST',
});

const DAY = 24 * 60 * 60 * 1000;

/** WeChat Pay answers every call with this signed body. */
const wechatAnswers = (body: object) => {
  const text = JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(text, { headers: wechatHeaders(platform.privateKey, text) })),
  );
};

const wechatNotification = (transaction: object) => {
  const body = JSON.stringify({
    event_type: 'TRANSACTION.SUCCESS',
    resource: wechatEncrypt(API_V3_KEY, JSON.stringify(transaction)),
  });
  return { body, headers: wechatHeaders(platform.privateKey, body) };
};

const wechatPaid = (outTradeNo: string, total: number, paidAt: Date) => ({
  amount: { currency: 'CNY', total },
  appid: 'wx_app',
  mchid: '1900000001',
  out_trade_no: outTradeNo,
  success_time: paidAt.toISOString(),
  trade_state: 'SUCCESS',
  transaction_id: `wx-${outTradeNo}`,
});

const alipayNotification = (outTradeNo: string, totalAmount: string) => {
  const fields: Record<string, string> = {
    app_id: '2021000000000001',
    out_trade_no: outTradeNo,
    total_amount: totalAmount,
    trade_no: `ali-${outTradeNo}`,
    trade_status: 'TRADE_SUCCESS',
  };
  return { ...fields, sign: signWith(alipayKeys.privateKey, signingContent(fields, [])) };
};

const outTradeNoOf = async (orderId: string) =>
  (await db.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)))[0].outTradeNo;

const prepaidRows = async () =>
  db.select().from(userSubscriptions).where(eq(userSubscriptions.userId, userId));

/** Buys a period with WeChat Pay, paid `daysAgo` days ago. */
const buyWithWechat = async (plan: Plans, interval: 'monthly' | 'yearly', daysAgo = 0) => {
  wechatAnswers({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' });
  const order = await service().createPrepaidOrder({ interval, plan, provider: 'wechat' });
  const outTradeNo = await outTradeNoOf(order.orderId);
  const { body, headers } = wechatNotification(
    wechatPaid(outTradeNo, order.amount, new Date(Date.now() - daysAgo * DAY)),
  );
  await handleWechatPayNotification(db, headers, body);
  return { order, outTradeNo };
};

let db: LobeChatDatabase;
let userId: string;
const service = () => new BillingService(db, userId);

beforeEach(async () => {
  db = await getTestDB();
  userId = await createTestUser(db);
  env.region.APP_REGION = 'cn';
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupTestUser(db, userId);
});

describe('what the mainland edition sells', () => {
  it('offers WeChat Pay and Alipay with the catalog prices in yuan', async () => {
    const status = await service().getStatus();

    expect(status.wechat.available).toBe(true);
    expect(status.alipay.available).toBe(true);
    expect(await listPlanPrices()).toContainEqual({
      currency: 'cny',
      interval: 'monthly',
      plan: Plans.Starter,
      unitAmount: 6800,
    });
  });

  it('does not sell prepaid periods in the Global edition', async () => {
    env.region.APP_REGION = 'global';

    await expect(
      service().createPrepaidOrder({
        interval: 'monthly',
        plan: Plans.Starter,
        provider: 'wechat',
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('paying with WeChat Pay', () => {
  it('shows a QR code, then switches the plan once the payment is notified', async () => {
    wechatAnswers({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' });
    const order = await service().createPrepaidOrder({
      interval: 'monthly',
      plan: Plans.Starter,
      provider: 'wechat',
    });
    expect(order).toMatchObject({ amount: 6800, codeUrl: 'weixin://wxpay/bizpayurl?pr=abc' });
    expect((await service().getStatus()).plan).toBe(Plans.Free);

    const outTradeNo = await outTradeNoOf(order.orderId);
    const paidAt = new Date(Date.now() - 60_000);
    const { body, headers } = wechatNotification(wechatPaid(outTradeNo, 6800, paidAt));
    await handleWechatPayNotification(db, headers, body);
    // WeChat Pay sends a notification again until it is acknowledged; it counts once
    await handleWechatPayNotification(db, headers, body);

    const status = await service().getStatus();
    expect(status.plan).toBe(Plans.Starter);
    expect(status.subscription).toMatchObject({ cancelAtPeriodEnd: true, provider: 'wechat' });
    const end = new Date(paidAt);
    end.setUTCMonth(end.getUTCMonth() + 1);
    expect(status.subscription?.currentPeriodEnd?.getTime()).toBe(end.getTime());
  });

  it('reads a pending order from WeChat Pay when the notification has not arrived', async () => {
    wechatAnswers({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' });
    const order = await service().createPrepaidOrder({
      interval: 'yearly',
      plan: Plans.Premium,
      provider: 'wechat',
    });
    const outTradeNo = await outTradeNoOf(order.orderId);
    wechatAnswers(wechatPaid(outTradeNo, 198_000, new Date()));

    await expect(service().getPrepaidOrder(order.orderId)).resolves.toMatchObject({
      plan: Plans.Premium,
      status: 'paid',
    });
    expect((await service().getStatus()).plan).toBe(Plans.Premium);
  });

  it('ignores a payment whose amount differs from the order', async () => {
    wechatAnswers({ code_url: 'weixin://x' });
    const order = await service().createPrepaidOrder({
      interval: 'monthly',
      plan: Plans.Ultimate,
      provider: 'wechat',
    });
    const outTradeNo = await outTradeNoOf(order.orderId);

    await expect(
      applyPaidOrder(db, {
        amount: 1,
        outTradeNo,
        paidAt: new Date(),
        provider: 'wechat',
        transactionId: 't',
      }),
    ).resolves.toBe('mismatch');
    expect((await service().getStatus()).plan).toBe(Plans.Free);
  });

  it('closes the order when WeChat Pay will not take it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"系统繁忙"}', { status: 500 })),
    );

    await expect(
      service().createPrepaidOrder({
        interval: 'monthly',
        plan: Plans.Starter,
        provider: 'wechat',
      }),
    ).rejects.toThrow('系统繁忙');
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.userId, userId));
    expect(order.status).toBe('closed');
  });
});

describe('periods', () => {
  it('adds a second month of the same plan to the first, keeping its start', async () => {
    await buyWithWechat(Plans.Starter, 'monthly', 5);
    const [first] = await prepaidRows();
    await buyWithWechat(Plans.Starter, 'monthly');

    const [row] = await prepaidRows();
    const end = new Date(first.currentPeriodEnd!);
    end.setUTCMonth(end.getUTCMonth() + 1);
    expect(row.currentPeriodStart).toEqual(first.currentPeriodStart);
    expect(row.currentPeriodEnd).toEqual(end);
  });

  it('carries the time paid through WeChat Pay into a renewal paid with Alipay', async () => {
    await buyWithWechat(Plans.Starter, 'monthly', 5);
    const [first] = await prepaidRows();

    const order = await service().createPrepaidOrder({
      interval: 'monthly',
      plan: Plans.Starter,
      provider: 'alipay',
    });
    expect(order.payUrl).toMatch(/^https:\/\/openapi\.alipay\.com\/gateway\.do\?/);
    expect(new URL(order.payUrl!).searchParams.get('return_url')).toBe(
      `https://app.biber.test/settings/plans?order=${order.orderId}`,
    );
    await handleAlipayNotification(
      db,
      alipayNotification(await outTradeNoOf(order.orderId), '68.00'),
    );

    const rows = await prepaidRows();
    const wechat = rows.find((row) => row.provider === 'wechat')!;
    const alipay = rows.find((row) => row.provider === 'alipay')!;
    const end = new Date(first.currentPeriodEnd!);
    end.setUTCMonth(end.getUTCMonth() + 1);
    expect(wechat.status).toBe('canceled');
    expect(alipay).toMatchObject({
      currentPeriodStart: first.currentPeriodStart,
      status: 'active',
    });
    expect(alipay.currentPeriodEnd).toEqual(end);
    expect((await service().getStatus()).subscription?.provider).toBe('alipay');
  });

  it('starts a higher plan at once', async () => {
    await buyWithWechat(Plans.Starter, 'yearly', 30);
    await buyWithWechat(Plans.Ultimate, 'monthly');

    const [row] = await prepaidRows();
    expect(row.plan).toBe(Plans.Ultimate);
    expect(Date.now() - row.currentPeriodStart!.getTime()).toBeLessThan(DAY);
  });

  it('does not sell a lower plan while a higher one runs', async () => {
    await buyWithWechat(Plans.Premium, 'monthly');

    await expect(
      service().createPrepaidOrder({ interval: 'yearly', plan: Plans.Starter, provider: 'alipay' }),
    ).rejects.toMatchObject({ code: 'LOWER_PLAN' });
  });

  it('ends the plan when the paid period is over', async () => {
    await buyWithWechat(Plans.Starter, 'monthly', 40);

    const status = await service().getStatus();
    expect(status.plan).toBe(Plans.Free);
    expect(status.subscription).toBeUndefined();
  });

  it('does not sell a period on top of an App Store subscription', async () => {
    await new UserSubscriptionModel(db, userId).linkCustomer('apple', `apple-${userId}`);
    await UserSubscriptionModel.applyProviderSnapshot(db, 'apple', `apple-${userId}`, {
      billingInterval: 'monthly',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() + 20 * DAY),
      currentPeriodStart: new Date(Date.now() - 10 * DAY),
      plan: Plans.Starter,
      providerSubscriptionId: `apple-sub-${userId}`,
      status: 'active',
    });

    await expect(
      service().createPrepaidOrder({
        interval: 'monthly',
        plan: Plans.Premium,
        provider: 'wechat',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED' });
  });
});
