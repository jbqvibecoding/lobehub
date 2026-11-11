import { type StringKey, t, tf } from '@/i18n/strings';

import type { BillingProvider, PlanId, PlanStatus } from './types';

/** One dollar of model usage, as the server counts credits. */
const CREDITS_PER_DOLLAR = 1_000_000;

const PLAN_NAMES: Record<PlanId, StringKey> = {
  free: 'planFree',
  hobby: 'planHobby',
  premium: 'planPremium',
  starter: 'planStarter',
  ultimate: 'planUltimate',
};

const BILLED_BY: Record<BillingProvider, StringKey> = {
  alipay: 'billedInChina',
  apple: 'billedByApple',
  stripe: 'billedByStripe',
  wechat: 'billedInChina',
};

/** Plans a newer server adds read as their raw name rather than breaking the screen. */
export const planName = (plan: string) => {
  const key = PLAN_NAMES[plan as PlanId];
  return key ? t(key) : plan;
};

/** Credits as the web shows them: millions as "5M", smaller amounts in full. */
export const formatCredits = (credits: number, locale?: string) => {
  if (credits < CREDITS_PER_DOLLAR)
    return new Intl.NumberFormat(locale).format(Math.round(credits));
  const millions = credits / CREDITS_PER_DOLLAR;
  const digits = credits % CREDITS_PER_DOLLAR ? 2 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(millions)}M`;
};

export const formatDay = (date: Date, locale?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);

/** What happens to the plan next: it renews, it ends, or a payment needs fixing. */
export const describeRenewal = (status: PlanStatus, locale?: string) => {
  const subscription = status.subscription;
  if (!subscription) return undefined;
  if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    return { text: t('planPastDue'), tone: 'problem' as const };
  }
  if (!subscription.currentPeriodEnd) return undefined;
  const date = formatDay(subscription.currentPeriodEnd, locale);
  return subscription.cancelAtPeriodEnd
    ? { text: tf('planEndsOn', { date }), tone: 'warning' as const }
    : { text: tf('planRenewsOn', { date }), tone: 'normal' as const };
};

/** Who bills the plan; unknown providers from a newer server are left unnamed. */
export const describeBilling = (provider: string | undefined) => {
  const key = BILLED_BY[provider as BillingProvider];
  return key ? t(key) : undefined;
};

export const describeCredits = ({ credits }: PlanStatus, locale?: string) => ({
  reset: tf('creditsReset', { date: formatDay(credits.periodEnd, locale) }),
  usedFraction: credits.monthly > 0 ? Math.min(1, credits.used / credits.monthly) : 0,
  usedText: tf('creditsUsed', {
    total: formatCredits(credits.monthly, locale),
    used: formatCredits(credits.used, locale),
  }),
});
