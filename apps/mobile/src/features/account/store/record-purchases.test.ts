import { TRPCClientError } from '@trpc/client';

import type { ApiClient } from '@/lib/api-client';

import type { Purchase } from './apple-store';
import { recordPurchases } from './record-purchases';

const purchase = (token: string | null = 'signed.jws.token') =>
  ({ productId: 'ai.biber.premium.monthly', purchaseToken: token }) as Purchase;

const serverError = (code: string) =>
  TRPCClientError.from({ error: { code: -32_000, data: { code }, message: code } } as never);

const run = async (mutation: jest.Mock, purchases = [purchase()]) => {
  const finish = jest.fn().mockResolvedValue(undefined);
  const outcome = await recordPurchases({
    api: { mutation } as unknown as ApiClient,
    purchases,
    store: { finish },
  });
  return { finish, outcome };
};

describe('recordPurchases', () => {
  it("sends Apple's signed transactions and finishes them once recorded", async () => {
    const mutation = jest.fn().mockResolvedValue({ plan: 'premium' });

    const { finish, outcome } = await run(mutation);

    expect(mutation).toHaveBeenCalledWith('subscription.syncApplePurchases', {
      signedTransactions: ['signed.jws.token'],
    });
    expect(finish).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('active');
  });

  it('finishes a purchase the server will never take, so StoreKit stops replaying it', async () => {
    const { finish, outcome } = await run(jest.fn().mockRejectedValue(serverError('CONFLICT')));

    expect(outcome).toBe('other-account');
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('keeps the purchase unfinished when the server cannot be reached', async () => {
    const { finish, outcome } = await run(
      jest.fn().mockRejectedValue(new TypeError('Network request failed')),
    );

    expect(outcome).toBe('retry-later');
    expect(finish).not.toHaveBeenCalled();
  });

  it('sends nothing without a signed transaction', async () => {
    const mutation = jest.fn();

    expect((await run(mutation, [purchase(null)])).outcome).toBe('rejected');
    expect(mutation).not.toHaveBeenCalled();
  });
});
