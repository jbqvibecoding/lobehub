import { Plans } from '@lobechat/types';
import { ConfigProvider } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as m from 'motion/react-m';
import { MemoryRouter } from 'react-router';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BillingPlans from './index';

const { service } = vi.hoisted(() => ({
  service: {
    createCheckout: vi.fn(),
    createPortal: vi.fn(),
    createPrepaidOrder: vi.fn(),
    getPrepaidOrder: vi.fn(),
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
  alipay: { available: false },
  plan: Plans.Free,
  stripe: { available: true, hasCustomer: false },
  subscription: undefined,
  wechat: { available: false },
};

const starterStatus = {
  credits: { monthly: 5_000_000, periodEnd: new Date('2026-12-01'), remaining: 5_000_000, used: 0 },
  alipay: { available: false },
  plan: Plans.Starter,
  stripe: { available: true, hasCustomer: true },
  wechat: { available: false },
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
    <ConfigProvider motion={m}>
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <MemoryRouter initialEntries={[path]}>
          <BillingPlans />
        </MemoryRouter>
      </SWRConfig>
    </ConfigProvider>,
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

  describe('mainland edition', () => {
    const mainland = (status: typeof freeStatus | typeof starterStatus) => ({
      ...status,
      alipay: { available: true },
      stripe: { available: false, hasCustomer: false },
      wechat: { available: true },
    });
    const prepaidPremium = {
      ...mainland(starterStatus),
      plan: Plans.Premium,
      subscription: { ...starterStatus.subscription, plan: Plans.Premium, provider: 'wechat' },
    };

    beforeEach(() => {
      service.getPrices.mockResolvedValue([
        { currency: 'cny', interval: 'monthly', plan: Plans.Starter, unitAmount: 6800 },
        { currency: 'cny', interval: 'monthly', plan: Plans.Premium, unitAmount: 19_800 },
      ]);
    });

    it('shows a WeChat Pay QR code and switches the plan once the payment arrives', async () => {
      service.getStatus.mockResolvedValue(mainland(freeStatus));
      service.createPrepaidOrder.mockResolvedValue({
        amount: 6800,
        codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
        orderId: 'o1',
        provider: 'wechat',
      });
      service.getPrepaidOrder.mockResolvedValue({ plan: Plans.Starter, status: 'paid' });
      renderPage();

      expect(await screen.findByText('planPage.perMonth(price=CN¥68.00)')).toBeInTheDocument();
      fireEvent.click(screen.getAllByText('plans.changePlan')[0]);
      fireEvent.click(await screen.findByText('planPage.pay.withWechat'));

      await waitFor(() =>
        expect(service.createPrepaidOrder).toHaveBeenCalledWith({
          interval: 'monthly',
          plan: Plans.Starter,
          provider: 'wechat',
        }),
      );
      await waitFor(() => expect(service.getPrepaidOrder).toHaveBeenCalledWith('o1'));
      expect(await screen.findByText('planPage.pay.done')).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
    });

    it("sends the user to Alipay's cashier when they pick Alipay", async () => {
      service.getStatus.mockResolvedValue(mainland(freeStatus));
      service.createPrepaidOrder.mockResolvedValue({
        amount: 6800,
        orderId: 'o2',
        payUrl: 'https://openapi.alipay.com/gateway.do?x=1',
        provider: 'alipay',
      });
      renderPage();

      fireEvent.click((await screen.findAllByText('plans.changePlan'))[0]);
      fireEvent.click(await screen.findByText('planPage.pay.alipay'));
      fireEvent.click(screen.getByText('planPage.pay.withAlipay'));

      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith('https://openapi.alipay.com/gateway.do?x=1'),
      );
    });

    it('says how long a prepaid plan is paid for, offers more time, and holds back lower plans', async () => {
      service.getStatus.mockResolvedValue(prepaidPremium);
      renderPage();

      expect(await screen.findByText(/^planPage\.paidThrough/)).toBeInTheDocument();
      expect(screen.getByText('planPage.extend').closest('button')).toBeEnabled();
      expect(screen.getByText('planPage.lowerPlanLater').closest('button')).toBeDisabled();
    });

    it('confirms the payment on coming back from Alipay', async () => {
      service.getStatus.mockResolvedValue(prepaidPremium);
      service.getPrepaidOrder.mockResolvedValue({ plan: Plans.Premium, status: 'paid' });
      renderPage('/settings/plans?order=o2');

      expect(await screen.findByText('planPage.checkoutSuccess')).toBeInTheDocument();
      expect(service.getPrepaidOrder).toHaveBeenCalledWith('o2');
    });
  });
});
