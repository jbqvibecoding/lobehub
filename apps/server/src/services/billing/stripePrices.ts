import { type BillingInterval, PLAN_CATALOG, type PlanDefinition } from '@lobechat/billing';
import type { Plans } from '@lobechat/types';
import type Stripe from 'stripe';

/** Marks the Stripe product that sells a plan, so the same product is reused for both intervals */
const PLAN_METADATA_KEY = 'biber_plan';

const STRIPE_INTERVAL: Record<BillingInterval, 'month' | 'year'> = {
  monthly: 'month',
  yearly: 'year',
};

export interface StripePriceChange {
  /** create: no price has the lookup key; replace: one has it with another amount or interval */
  action: 'create' | 'ok' | 'replace';
  amount: number;
  interval: BillingInterval;
  lookupKey: string;
  plan: Plans;
  /** The amount of the price being replaced, in US cents */
  previousAmount?: number | null;
}

type StripePrices = Pick<Stripe, 'prices' | 'products'>;

const wantedPrices = (catalog: Record<Plans, PlanDefinition>) =>
  (Object.entries(catalog) as [Plans, PlanDefinition][]).flatMap(([plan, definition]) =>
    (['monthly', 'yearly'] as const).flatMap((interval) => {
      const lookupKey = definition.stripeLookupKeys?.[interval];
      const amount = definition.usdPrices?.[interval];
      return lookupKey && amount !== undefined ? [{ amount, interval, lookupKey, plan }] : [];
    }),
  );

const productName = (plan: Plans) => `Biber ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;

/**
 * Brings the Stripe prices in line with the plan catalog. Each sold plan has one product and a
 * recurring US dollar price per interval, found by lookup key. A price whose amount or interval
 * differs is replaced: a new price takes over the lookup key and the old one is archived, so
 * existing subscribers keep their price until they change plan. Without `apply`, nothing is
 * written and the changes that would be made are returned.
 */
export const syncStripePrices = async (
  stripe: StripePrices,
  { apply = false, catalog = PLAN_CATALOG }: { apply?: boolean; catalog?: typeof PLAN_CATALOG },
): Promise<StripePriceChange[]> => {
  const wanted = wantedPrices(catalog);
  if (wanted.length === 0) return [];

  const existing = new Map<string, Stripe.Price>();
  for await (const price of stripe.prices.list({
    active: true,
    limit: 100,
    lookup_keys: wanted.map((price) => price.lookupKey),
  })) {
    if (price.lookup_key) existing.set(price.lookup_key, price);
  }

  const changes: StripePriceChange[] = wanted.map(({ amount, interval, lookupKey, plan }) => {
    const current = existing.get(lookupKey);
    if (!current) return { action: 'create', amount, interval, lookupKey, plan };

    const same =
      current.currency === 'usd' &&
      current.unit_amount === amount &&
      current.recurring?.interval === STRIPE_INTERVAL[interval] &&
      (current.recurring?.interval_count ?? 1) === 1;
    return same
      ? { action: 'ok', amount, interval, lookupKey, plan }
      : {
          action: 'replace',
          amount,
          interval,
          lookupKey,
          plan,
          previousAmount: current.unit_amount,
        };
  });

  if (!apply) return changes;

  const productIds = new Map<Plans, string>();
  for (const { lookupKey, plan } of wanted) {
    const current = existing.get(lookupKey);
    if (current && !productIds.has(plan)) {
      productIds.set(
        plan,
        typeof current.product === 'string' ? current.product : current.product.id,
      );
    }
  }

  const productFor = async (plan: Plans) => {
    const known = productIds.get(plan);
    if (known) return known;

    for await (const product of stripe.products.list({ active: true, limit: 100 })) {
      if (product.metadata?.[PLAN_METADATA_KEY] === plan) {
        productIds.set(plan, product.id);
        return product.id;
      }
    }
    const created = await stripe.products.create({
      metadata: { [PLAN_METADATA_KEY]: plan },
      name: productName(plan),
    });
    productIds.set(plan, created.id);
    return created.id;
  };

  for (const change of changes) {
    if (change.action === 'ok') continue;

    await stripe.prices.create({
      currency: 'usd',
      lookup_key: change.lookupKey,
      metadata: { [PLAN_METADATA_KEY]: change.plan },
      product: await productFor(change.plan),
      recurring: { interval: STRIPE_INTERVAL[change.interval] },
      transfer_lookup_key: change.action === 'replace',
      unit_amount: change.amount,
    });

    const replaced = existing.get(change.lookupKey);
    if (change.action === 'replace' && replaced) {
      await stripe.prices.update(replaced.id, { active: false });
    }
  }

  return changes;
};
