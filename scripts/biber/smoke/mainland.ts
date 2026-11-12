/**
 * The mainland edition's own paths, against a running `APP_REGION=cn` server: sign in with a code
 * texted to a mainland mobile number, buy a month of a plan with Alipay, receive Alipay's signed
 * payment notification, and find the plan active; the same notification again changes nothing.
 *
 *   bunx tsx scripts/biber/smoke/mainland.ts
 *
 * The server needs:
 *   ALIYUN_SMS_ACCESS_KEY_ID, _SECRET, _SIGN_NAME, _TEMPLATE_CODE (any values) and
 *   ALIYUN_SMS_ENDPOINT=http://127.0.0.1:4030;
 *   ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, and ALIPAY_PUBLIC_KEY set to the public half of the key
 *   this script signs notifications with (SMOKE_ALIPAY_SIGNING_KEY, a PEM file).
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signingContent } from '../../../apps/server/src/services/billing/mainland/alipay';
import { readPrivateKey } from '../../../apps/server/src/services/billing/mainland/keys';
import { SmokeClient, waitFor } from './client';
import { startFakeAliyunSms } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3011';
const SMS_PORT = Number(process.env.SMOKE_SMS_PORT ?? 4030);
const ALIPAY_APP_ID = process.env.SMOKE_ALIPAY_APP_ID ?? '2021000000000001';
const signingKey = readPrivateKey(readFileSync(process.env.SMOKE_ALIPAY_SIGNING_KEY!, 'utf8'));

const steps: { name: string; ok: boolean }[] = [];
const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    const value = await run();
    steps.push({ name, ok: true });
    console.log(`✓ ${name}`);
    return value;
  } catch (error) {
    steps.push({ name, ok: false });
    console.log(`✗ ${name}: ${error}`);
    throw error;
  }
};

/** Alipay's asynchronous notification for a paid trade, signed as Alipay signs it. */
const alipayNotification = (outTradeNo: string, totalAmount: string) => {
  const fields: Record<string, string> = {
    app_id: ALIPAY_APP_ID,
    gmt_payment: new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' '),
    notify_id: `notify-${Date.now()}`,
    notify_time: new Date().toISOString(),
    notify_type: 'trade_status_sync',
    out_trade_no: outTradeNo,
    total_amount: totalAmount,
    trade_no: `2026${Date.now()}`,
    trade_status: 'TRADE_SUCCESS',
  };
  const sign = createSign('RSA-SHA256')
    .update(signingContent(fields, []), 'utf8')
    .sign(signingKey, 'base64');
  return new URLSearchParams({ ...fields, sign, sign_type: 'RSA2' });
};

const main = async () => {
  const sms = await startFakeAliyunSms(SMS_PORT);
  const client = new SmokeClient(BASE_URL);
  // A unique mainland mobile number per run: 138 + 8 digits
  const national = `138${String(Date.now()).slice(-8)}`;
  const phoneNumber = `+86${national}`;

  try {
    await step('a sign-in code is texted to the number', async () => {
      await client.auth('/phone-number/send-otp', { phoneNumber });
      await waitFor('the text message', async () => sms.codes.get(national), 15_000);
    });

    await step('the code signs in a new account', () =>
      client.auth('/phone-number/verify', { code: sms.codes.get(national), phoneNumber }),
    );

    const before = await step(
      'the plans are sold in yuan through WeChat Pay or Alipay',
      async () => {
        const status = await client.query<any>('mobile', 'subscription.status');
        if (!status.alipay.available || status.stripe.available) {
          throw new Error(
            `payment methods: ${JSON.stringify({ alipay: status.alipay, stripe: status.stripe })}`,
          );
        }
        return status;
      },
    );
    if (before.plan !== 'free') throw new Error(`a new account starts on ${before.plan}`);

    const order = await step('an Alipay order opens the cashier page', async () => {
      const created = await client.mutation<{ amount: number; payUrl: string }>(
        'lambda',
        'subscription.createPrepaidOrder',
        { interval: 'monthly', plan: 'starter', provider: 'alipay' },
      );
      const biz = JSON.parse(new URL(created.payUrl).searchParams.get('biz_content') ?? '{}');
      if (!biz.out_trade_no || biz.total_amount !== '68.00') {
        throw new Error(`unexpected order: ${JSON.stringify(biz)}`);
      }
      return { amount: biz.total_amount as string, outTradeNo: biz.out_trade_no as string };
    });

    const notify = alipayNotification(order.outTradeNo, order.amount);
    await step("Alipay's payment notification is accepted", async () => {
      const response = await fetch(`${BASE_URL}/api/webhooks/alipay`, {
        body: notify,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
      const text = await response.text();
      if (text !== 'success') throw new Error(`HTTP ${response.status}: ${text}`);
    });

    const paid = await step('the plan is active for a month', async () => {
      const status = await client.query<any>('mobile', 'subscription.status');
      const end = new Date(status.subscription?.currentPeriodEnd ?? 0).getTime();
      const days = (end - Date.now()) / 86_400_000;
      if (
        status.plan !== 'starter' ||
        status.subscription?.provider !== 'alipay' ||
        days < 27 ||
        days > 32
      ) {
        throw new Error(
          JSON.stringify({ days, plan: status.plan, subscription: status.subscription }),
        );
      }
      return status;
    });

    await step('the same notification again changes nothing', async () => {
      await fetch(`${BASE_URL}/api/webhooks/alipay`, {
        body: notify,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
      const status = await client.query<any>('mobile', 'subscription.status');
      if (
        new Date(status.subscription.currentPeriodEnd).getTime() !==
        new Date(paid.subscription.currentPeriodEnd).getTime()
      ) {
        throw new Error('the period was extended twice');
      }
    });

    await step('a forged notification is refused', async () => {
      const forged = alipayNotification(order.outTradeNo, order.amount);
      forged.set('total_amount', '0.01');
      const response = await fetch(`${BASE_URL}/api/webhooks/alipay`, {
        body: forged,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
      if ((await response.text()) === 'success')
        throw new Error('a changed notification was accepted');
    });
  } finally {
    sms.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
  }
};

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
