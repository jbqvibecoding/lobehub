// @vitest-environment node
import { Plans } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subscriptionRouter } from '@/business/server/lambda-routers/subscription';
import { mobileSubscriptionRouter } from '@/business/server/mobile-routers/mobileSubscription';

const { billing, MockBillingError } = vi.hoisted(() => {
  class MockBillingError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    billing: {
      createCheckoutUrl: vi.fn(),
      createPortalUrl: vi.fn(),
      getStatus: vi.fn(),
      refresh: vi.fn(),
    },
    MockBillingError,
  };
});

vi.mock('@/server/services/billing', () => ({
  BillingError: MockBillingError,
  BillingService: vi.fn().mockImplementation(() => billing),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

const caller = () => subscriptionRouter.createCaller({ jwtPayload: {}, userId: 'user-1' } as any);

describe('subscription router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the Checkout link for a paid plan', async () => {
    billing.createCheckoutUrl.mockResolvedValue('https://checkout.stripe.test/c1');

    await expect(
      caller().createCheckout({ interval: 'yearly', plan: Plans.Premium }),
    ).resolves.toEqual({ url: 'https://checkout.stripe.test/c1' });
    expect(billing.createCheckoutUrl).toHaveBeenCalledWith({
      interval: 'yearly',
      plan: Plans.Premium,
    });
  });

  it('does not take the free plan or an unknown interval as something to buy', async () => {
    await expect(
      caller().createCheckout({ interval: 'monthly', plan: Plans.Free as any }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller().createCheckout({ interval: 'weekly' as any, plan: Plans.Starter }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(billing.createCheckoutUrl).not.toHaveBeenCalled();
  });

  it('answers with an error code the client can act on', async () => {
    billing.createCheckoutUrl.mockRejectedValue(new MockBillingError('ALREADY_SUBSCRIBED', 'x'));
    billing.createPortalUrl.mockRejectedValue(new MockBillingError('NO_CUSTOMER', 'x'));

    await expect(
      caller().createCheckout({ interval: 'monthly', plan: Plans.Starter }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(caller().createPortal()).rejects.toMatchObject({ code: 'NOT_FOUND' });

    billing.createPortalUrl.mockRejectedValue(new MockBillingError('UNAVAILABLE', 'x'));
    await expect(caller().createPortal()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('lets the phone read the plan but not buy one', async () => {
    billing.getStatus.mockResolvedValue({ plan: Plans.Starter });
    const phone = mobileSubscriptionRouter.createCaller({ jwtPayload: {}, userId: 'u' } as any);

    await expect(phone.status()).resolves.toEqual({ plan: Plans.Starter });
    expect(Object.keys(mobileSubscriptionRouter._def.procedures)).toEqual(['status']);
  });

  it('refuses callers who are not signed in', async () => {
    const anonymous = subscriptionRouter.createCaller({} as any);

    await expect(anonymous.status()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
