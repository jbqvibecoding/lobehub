import { Plans } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BillingPlans from './index';

const { service } = vi.hoisted(() => ({
  service: {
    createCheckout: vi.fn(),
    createPortal: vi.fn(),
    getPrices: vi.fn(),
    getStatus: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock('@/services/subscription', () => ({ subscriptionService: service }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, options?: Record<string, string>) =>
      options
        ? `${key}(${Object.entries(options)
            .map(([name, value]) => `${name}=${value}`)
            .join(',')})`
        : key,
  }),
}));

const freeStatus = {
  credits: {
    monthly: 500_000,
    periodEnd: new Date('2026-12-01'),
    remaining: 380_000,
    used: 120_000,
  },
  plan: Plans.Free,
  stripe: { available: true, hasCustomer: false },
  subscription: undefined,
};

const starterStatus = {
  credits: { monthly: 5_000_000, periodEnd: new Date('2026-12-01'), remaining: 5_000_000, used: 0 },
  plan: Plans.Starter,
  stripe: { available: true, hasCustomer: true },
  subscription: {
    billingInterval: 'monthly',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date('2026-12-01'),
    plan: Plans.Starter,
    provider: 'stripe',
    status: 'active',
  },
};

const renderPage = (path = '/settings/plans') =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <MemoryRouter initialEntries={[path]}>
        <BillingPlans />
      </MemoryRouter>
    </SWRConfig>,
  );

describe('BillingPlans', () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, assign });
    service.getPrices.mockResolvedValue([
      { currency: 'usd', interval: 'monthly', plan: Plans.Starter, unitAmount: 900 },
      { currency: 'usd', interval: 'yearly', plan: Plans.Starter, unitAmount: 9000 },
    ]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows this month's credits and sends a free user to Checkout for the chosen plan", async () => {
    service.getStatus.mockResolvedValue(freeStatus);
    service.createCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/c1' });
    renderPage();

    expect(
      await screen.findByText('planPage.creditsUsed(total=500,000,used=120,000)'),
    ).toBeInTheDocument();
    expect(await screen.findByText('planPage.perMonth(price=$9.00)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('planPage.yearly'));
    expect(await screen.findByText('planPage.perYear(price=$90.00)')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('plans.changePlan')[0]);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/c1'));
    expect(service.createCheckout).toHaveBeenCalledWith({
      interval: 'yearly',
      plan: Plans.Starter,
    });
  });

  it('sends a subscriber to the billing portal to change or cancel, and says when the plan ends', async () => {
    service.getStatus.mockResolvedValue(starterStatus);
    service.createPortal.mockResolvedValue({ url: 'https://billing.stripe.test' });
    renderPage();

    expect(await screen.findByText(/^planPage\.endsOn/)).toBeInTheDocument();
    expect(screen.getByText('planPage.current').closest('button')).toBeDisabled();

    fireEvent.click(screen.getAllByText('planPage.changePlan')[0]);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.test'));
    expect(service.createCheckout).not.toHaveBeenCalled();
  });

  it('reads the new plan from Stripe on returning from Checkout', async () => {
    service.getStatus.mockResolvedValue(freeStatus);
    service.refresh.mockResolvedValue(starterStatus);
    renderPage('/settings/plans?checkout=success');

    expect(await screen.findByText('planPage.checkoutSuccess')).toBeInTheDocument();
    await waitFor(() => expect(service.refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('planPage.current')).toBeInTheDocument();
  });

  it('keeps the user on the page with a message when Checkout cannot be opened', async () => {
    service.getStatus.mockResolvedValue(freeStatus);
    service.createCheckout.mockRejectedValue(new Error('offline'));
    renderPage();

    fireEvent.click((await screen.findAllByText('plans.changePlan'))[0]);

    expect(await screen.findByText('planPage.checkoutError')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
