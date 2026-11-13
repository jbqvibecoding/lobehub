// @vitest-environment node
import { PLAN_CATALOG } from '@lobechat/billing';
import { Plans } from '@lobechat/types';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

import { syncStripePrices } from '../stripePrices';

const price = (overrides: Partial<Stripe.Price> & { lookup_key: string }): Stripe.Price =>
  ({
    active: true,
    currency: 'usd',
    id: `price_${overrides.lookup_key}`,
    product: 'prod_existing',
    recurring: { interval: 'month', interval_count: 1 },
    unit_amount: 990,
    ...overrides,
  }) as Stripe.Price;

/** A Stripe client holding the given active prices and products, recording what it is asked to do */
const fakeStripe = (prices: Stripe.Price[], products: Partial<Stripe.Product>[] = []) => {
  const listed = async function* <T>(items: T[]) {
    yield* items;
  };
  return {
    prices: {
      create: vi.fn(async (params: Stripe.PriceCreateParams) => ({ id: 'price_new', ...params })),
      list: vi.fn((params: Stripe.PriceListParams) =>
        listed(prices.filter((p) => params.lookup_keys?.includes(p.lookup_key!))),
      ),
      update: vi.fn(async (id: string, params: Stripe.PriceUpdateParams) => ({ id, ...params })),
    },
    products: {
      create: vi.fn(async (params: Stripe.ProductCreateParams) => ({
        id: `prod_${params.metadata?.biber_plan}`,
      })),
      list: vi.fn(() => listed(products)),
    },
  } as unknown as Pick<Stripe, 'prices' | 'products'> & {
    prices: Record<'create' | 'list' | 'update', ReturnType<typeof vi.fn>>;
    products: Record<'create' | 'list', ReturnType<typeof vi.fn>>;
  };
};

const starterOnly = {
  ...PLAN_CATALOG,
  [Plans.Premium]: { monthlyCredits: 0 },
  [Plans.Ultimate]: { monthlyCredits: 0 },
};

describe('syncStripePrices', () => {
  it('only reports the six prices to create when Stripe has none, without writing', async () => {
    const stripe = fakeStripe([]);

    const changes = await syncStripePrices(stripe, {});

    expect(changes).toHaveLength(6);
    expect(changes.every((change) => change.action === 'create')).toBe(true);
    expect(changes.find((c) => c.lookupKey === 'biber_ultimate_yearly')?.amount).toBe(69_000);
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.products.create).not.toHaveBeenCalled();
  });

  it('creates one product per plan and a recurring dollar price per interval', async () => {
    const stripe = fakeStripe([]);

    await syncStripePrices(stripe, { apply: true, catalog: starterOnly });

    expect(stripe.products.create).toHaveBeenCalledTimes(1);
    expect(stripe.products.create).toHaveBeenCalledWith({
      metadata: { biber_plan: 'starter' },
      name: 'Biber Starter',
    });
    expect(stripe.prices.create.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({
        currency: 'usd',
        lookup_key: 'biber_starter_monthly',
        product: 'prod_starter',
        recurring: { interval: 'month' },
        transfer_lookup_key: false,
        unit_amount: 990,
      }),
      expect.objectContaining({
        lookup_key: 'biber_starter_yearly',
        product: 'prod_starter',
        recurring: { interval: 'year' },
        unit_amount: 9900,
      }),
    ]);
  });

  it('reuses the product a plan already has in Stripe', async () => {
    const stripe = fakeStripe(
      [],
      [{ id: 'prod_from_dashboard', metadata: { biber_plan: 'starter' } }],
    );

    await syncStripePrices(stripe, { apply: true, catalog: starterOnly });

    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(
      stripe.prices.create.mock.calls.every(([p]) => p.product === 'prod_from_dashboard'),
    ).toBe(true);
  });

  it('replaces a price whose amount changed and archives the old one', async () => {
    const stripe = fakeStripe([
      price({ lookup_key: 'biber_starter_monthly', unit_amount: 900 }),
      price({
        lookup_key: 'biber_starter_yearly',
        recurring: { interval: 'year' } as any,
        unit_amount: 9900,
      }),
    ]);

    const changes = await syncStripePrices(stripe, { apply: true, catalog: starterOnly });

    expect(changes.map(({ action, lookupKey }) => [lookupKey, action])).toEqual([
      ['biber_starter_monthly', 'replace'],
      ['biber_starter_yearly', 'ok'],
    ]);
    expect(changes[0].previousAmount).toBe(900);
    expect(stripe.prices.create).toHaveBeenCalledTimes(1);
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup_key: 'biber_starter_monthly',
        product: 'prod_existing',
        transfer_lookup_key: true,
        unit_amount: 990,
      }),
    );
    expect(stripe.prices.update).toHaveBeenCalledWith('price_biber_starter_monthly', {
      active: false,
    });
  });

  it('replaces a price sold on the wrong interval', async () => {
    const stripe = fakeStripe([
      price({ lookup_key: 'biber_starter_monthly', unit_amount: 990 }),
      // a yearly lookup key on a monthly price
      price({ lookup_key: 'biber_starter_yearly', unit_amount: 9900 }),
    ]);

    const changes = await syncStripePrices(stripe, { catalog: starterOnly });

    expect(changes.map((change) => change.action)).toEqual(['ok', 'replace']);
  });

  it('changes nothing when Stripe already matches the catalog', async () => {
    const stripe = fakeStripe([
      price({ lookup_key: 'biber_starter_monthly', unit_amount: 990 }),
      price({
        lookup_key: 'biber_starter_yearly',
        recurring: { interval: 'year' } as any,
        unit_amount: 9900,
      }),
    ]);

    const changes = await syncStripePrices(stripe, { apply: true, catalog: starterOnly });

    expect(changes.every((change) => change.action === 'ok')).toBe(true);
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.prices.update).not.toHaveBeenCalled();
  });
});
