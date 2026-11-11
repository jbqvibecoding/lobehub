export interface CreditPeriod {
  /** Exclusive */
  end: Date;
  /** Inclusive */
  start: Date;
}

/**
 * `months` after the anchor, on the anchor's day and time of day (UTC). A month too short for
 * that day uses its last day, and every step is counted from the anchor itself, so a 31st anchor
 * does not drift to the 28th for good after one February.
 */
const monthsAfter = (anchor: Date, months: number): Date => {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), lastDayOfMonth),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
};

/**
 * The monthly credit window containing `now`. Windows repeat monthly from the anchor: the start
 * of the paid period for a subscriber (so a yearly plan still gets credits every month), or the
 * day the account was created on the free plan.
 */
export const creditPeriodAt = (anchor: Date, now: Date): CreditPeriod => {
  let index =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth());
  if (monthsAfter(anchor, index) > now) index -= 1;

  return { end: monthsAfter(anchor, index + 1), start: monthsAfter(anchor, index) };
};
