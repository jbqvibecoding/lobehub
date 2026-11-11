import { randomBytes } from 'node:crypto';

import {
  type BillingInterval,
  isGranting,
  isPrepaidProvider,
  planRank,
  prepaidPeriod,
  type PrepaidProvider,
} from '@lobechat/billing';
import { isPaymentProviderAvailable } from '@lobechat/region';
import { Plans } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import { PaymentOrderModel } from '@/database/models/paymentOrder';
import { UserSubscriptionModel } from '@/database/models/userSubscription';
import type { PaymentOrderItem, UserSubscriptionItem } from '@/database/schemas';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { billingEnv } from '@/envs/billing';
import { regionEnv } from '@/envs/region';

import { type Alipay, AlipayError, createAlipay, fen, isAlipayPaid } from './alipay';
import { createWechatPay, type WechatPay, WechatPayError } from './wechatpay';

export { AlipayError } from './alipay';
export { WechatPayError } from './wechatpay';

const log = debug('lobe-server:billing:mainland');

export const isWechatPayConfigured = () =>
  !!(
    billingEnv.WECHATPAY_MCHID &&
    billingEnv.WECHATPAY_APPID &&
    billingEnv.WECHATPAY_APIV3_KEY &&
    billingEnv.WECHATPAY_MERCHANT_SERIAL_NO &&
    billingEnv.WECHATPAY_PRIVATE_KEY &&
    billingEnv.WECHATPAY_PUBLIC_KEY &&
    billingEnv.WECHATPAY_PUBLIC_KEY_ID
  );

export const isAlipayConfigured = () =>
  !!(billingEnv.ALIPAY_APP_ID && billingEnv.ALIPAY_PRIVATE_KEY && billingEnv.ALIPAY_PUBLIC_KEY);

/** Whether this deployment sells prepaid periods through `provider` (mainland edition only). */
export const isPrepaidOffered = (provider: PrepaidProvider) =>
  (provider === 'wechat' ? isWechatPayConfigured() : isAlipayConfigured()) &&
  isPaymentProviderAvailable(regionEnv.APP_REGION, provider);

let wechatPay: WechatPay | undefined;
export const getWechatPay = (): WechatPay => {
  if (!isWechatPayConfigured()) throw new Error('WeChat Pay is not configured');
  wechatPay ??= createWechatPay({
    apiV3Key: billingEnv.WECHATPAY_APIV3_KEY!,
    appId: billingEnv.WECHATPAY_APPID!,
    merchantId: billingEnv.WECHATPAY_MCHID!,
    merchantSerialNo: billingEnv.WECHATPAY_MERCHANT_SERIAL_NO!,
    privateKey: billingEnv.WECHATPAY_PRIVATE_KEY!,
    publicKey: billingEnv.WECHATPAY_PUBLIC_KEY!,
    publicKeyId: billingEnv.WECHATPAY_PUBLIC_KEY_ID!,
  });
  return wechatPay;
};

let alipay: Alipay | undefined;
export const getAlipay = (): Alipay => {
  if (!isAlipayConfigured()) throw new Error('Alipay is not configured');
  alipay ??= createAlipay({
    alipayPublicKey: billingEnv.ALIPAY_PUBLIC_KEY!,
    appId: billingEnv.ALIPAY_APP_ID!,
    gateway: billingEnv.ALIPAY_GATEWAY,
    privateKey: billingEnv.ALIPAY_PRIVATE_KEY!,
  });
  return alipay;
};

/** How long a QR code or cashier page stays payable. */
export const ORDER_TTL_MS = 30 * 60 * 1000;

const PLAN_NAMES: Partial<Record<Plans, string>> = {
  [Plans.Premium]: '进阶版',
  [Plans.Starter]: '基础版',
  [Plans.Ultimate]: '专业版',
};

/** What the payer sees in WeChat or Alipay, e.g. `Biber 基础版（月付）`. */
export const orderSubject = (plan: Plans, interval: BillingInterval) =>
  `Biber ${PLAN_NAMES[plan] ?? plan}（${interval === 'monthly' ? '月付' : '年付'}）`;

/** 30 characters, time first so orders sort by date at the provider: `20261111103000a1b2c3d4e5f60718`. */
export const newOrderNumber = (now = new Date()) =>
  `${now.toISOString().replaceAll(/\D/g, '').slice(0, 14)}${randomBytes(8).toString('hex')}`;

export const webhookUrl = (provider: PrepaidProvider) =>
  `${appEnv.APP_URL}/api/webhooks/${provider === 'wechat' ? 'wechatpay' : 'alipay'}`;

/** The prepaid period running now, if any: the highest plan among them. */
export const grantingPrepaid = (rows: UserSubscriptionItem[], now = new Date()) =>
  rows
    .filter((row) => isPrepaidProvider(row.provider) && isGranting(row, now))
    .sort((a, b) => planRank(b.plan) - planRank(a.plan))[0];

export type PaidOrderOutcome =
  /** The order was paid now and the plan extended */
  | 'applied'
  /** The provider reported this payment before */
  | 'duplicate'
  /** A lower plan was paid while a higher one runs (two orders paid at once); needs a refund */
  | 'lower_plan'
  /** The amount differs from the order's */
  | 'mismatch'
  /** We placed no such order */
  | 'unknown';

/**
 * Records a payment the provider confirmed and extends the user's plan by what it bought. Every
 * payment of one user is applied in turn, so two at once cannot both extend the same period, and a
 * payment reported twice counts once.
 */
export const applyPaidOrder = async (
  db: LobeChatDatabase,
  payment: {
    amount: number;
    outTradeNo: string;
    paidAt: Date;
    provider: PrepaidProvider;
    transactionId: string;
  },
): Promise<PaidOrderOutcome> =>
  db.transaction(async (tx) => {
    const order = await PaymentOrderModel.findByOutTradeNo(tx, payment.outTradeNo);
    if (!order || order.provider !== payment.provider) {
      log('payment for unknown order %s (%s)', payment.outTradeNo, payment.provider);
      return 'unknown';
    }
    if (order.amount !== payment.amount) {
      console.error(
        `[billing] order ${order.outTradeNo} was paid ${payment.amount} but costs ${order.amount}`,
      );
      return 'mismatch';
    }

    await tx.select({ id: users.id }).from(users).where(eq(users.id, order.userId)).for('update');

    const paid = await PaymentOrderModel.markPaid(tx, order.outTradeNo, {
      paidAt: payment.paidAt,
      providerTransactionId: payment.transactionId,
    });
    if (!paid) return 'duplicate';

    const subscriptions = new UserSubscriptionModel(tx, order.userId);
    const current = grantingPrepaid(await subscriptions.list(), payment.paidAt);
    const period = prepaidPeriod({
      current,
      interval: order.billingInterval,
      paidAt: payment.paidAt,
      plan: order.plan,
    });
    if (!period.ok) {
      console.error(
        `[billing] order ${order.outTradeNo} paid for ${order.plan} while ${current?.plan} runs; refund it`,
      );
      return 'lower_plan';
    }

    await subscriptions.savePrepaidPeriod(order.provider, {
      billingInterval: order.billingInterval,
      // Nothing renews: the period ends unless the user pays again
      cancelAtPeriodEnd: true,
      currentPeriodEnd: period.end,
      currentPeriodStart: period.start,
      plan: order.plan,
      providerSubscriptionId: order.outTradeNo,
      status: 'active',
    });
    // The period paid through the other method was carried into this one, or replaced by it
    if (current && current.provider !== order.provider) {
      await subscriptions.endWith(current.provider, payment.paidAt);
    }

    log('order %s: %s until %s', order.outTradeNo, order.plan, period.end.toISOString());
    return 'applied';
  });

/** A provider's payment time, never later than now. */
const paidAtFrom = (time: string | undefined, now: Date) => {
  const parsed = time ? new Date(time) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) && parsed < now ? parsed : now;
};

/** `2026-11-11 10:30:00` (Beijing) as Alipay writes it, to an ISO time. */
const alipayDate = (time: string | undefined) =>
  time ? `${time.replace(' ', 'T')}+08:00` : undefined;

/** A WeChat Pay payment notification. Throws `WechatPayError` when WeChat Pay did not sign it. */
export const handleWechatPayNotification = async (
  db: LobeChatDatabase,
  headers: { get: (name: string) => string | null },
  body: string,
  now = new Date(),
) => {
  const transaction = getWechatPay().readNotification(headers, body, now);
  if (!transaction || transaction.trade_state !== 'SUCCESS') return;

  await applyPaidOrder(db, {
    amount: transaction.amount?.total ?? Number.NaN,
    outTradeNo: transaction.out_trade_no,
    paidAt: paidAtFrom(transaction.success_time, now),
    provider: 'wechat',
    transactionId: transaction.transaction_id ?? '',
  });
};

/** An Alipay payment notification (the posted form). Throws `AlipayError` when Alipay did not sign it. */
export const handleAlipayNotification = async (
  db: LobeChatDatabase,
  fields: Record<string, string>,
  now = new Date(),
) => {
  const trade = getAlipay().readNotification(fields);
  if (!isAlipayPaid(trade.trade_status)) return;

  await applyPaidOrder(db, {
    amount: fen(trade.total_amount),
    outTradeNo: trade.out_trade_no,
    paidAt: paidAtFrom(alipayDate(trade.gmt_payment), now),
    provider: 'alipay',
    transactionId: trade.trade_no ?? '',
  });
};

const QUERY_INTERVAL_MS = 3000;
/** When each order was last read from its provider, so a page polling it does not flood them. */
const lastQueried = new Map<string, number>();

/**
 * Reads a pending order from its provider and applies it when it was paid; the page waiting for a
 * payment calls this, so the plan changes even while a notification is late or lost.
 */
export const refreshPrepaidOrder = async (
  db: LobeChatDatabase,
  order: PaymentOrderItem,
  now = new Date(),
) => {
  if (order.status !== 'pending' || !isPrepaidOffered(order.provider)) return;
  if (now.getTime() - (lastQueried.get(order.outTradeNo) ?? 0) < QUERY_INTERVAL_MS) return;
  lastQueried.set(order.outTradeNo, now.getTime());
  if (lastQueried.size > 10_000) lastQueried.clear();

  try {
    if (order.provider === 'wechat') {
      const transaction = await getWechatPay().queryOrder(order.outTradeNo);
      if (transaction.trade_state !== 'SUCCESS') return;
      await applyPaidOrder(db, {
        amount: transaction.amount?.total ?? Number.NaN,
        outTradeNo: order.outTradeNo,
        paidAt: paidAtFrom(transaction.success_time, now),
        provider: 'wechat',
        transactionId: transaction.transaction_id ?? '',
      });
    } else {
      const trade = await getAlipay().queryTrade(order.outTradeNo);
      if (!trade || !isAlipayPaid(trade.trade_status)) return;
      await applyPaidOrder(db, {
        amount: fen(trade.total_amount),
        outTradeNo: order.outTradeNo,
        paidAt: paidAtFrom(alipayDate(trade.send_pay_date ?? trade.gmt_payment), now),
        provider: 'alipay',
        transactionId: trade.trade_no ?? '',
      });
    }
  } catch (error) {
    if (error instanceof WechatPayError || error instanceof AlipayError) {
      log('reading order %s failed: %s', order.outTradeNo, error.message);
      return;
    }
    throw error;
  }
};
