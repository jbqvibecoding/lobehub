import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';

import { formatIntergerNumber, formatNumber } from '@/utils/format';

/** A Stripe amount (smallest currency unit) as a localized price, e.g. 900 usd → "$9.00". */
export const formatPlanPrice = (unitAmount: number, currency: string, locale?: string) => {
  const format = new Intl.NumberFormat(locale, {
    currency: currency.toUpperCase(),
    style: 'currency',
  });
  const fractionDigits = format.resolvedOptions().maximumFractionDigits ?? 2;

  return format.format(unitAmount / 10 ** fractionDigits);
};

/** Credits as the plans show them: millions as "5M", smaller amounts in full. */
export const formatCredits = (credits: number) =>
  credits >= CREDITS_PER_DOLLAR
    ? `${formatNumber(credits / CREDITS_PER_DOLLAR, credits % CREDITS_PER_DOLLAR ? 2 : 0)}M`
    : formatIntergerNumber(credits);
