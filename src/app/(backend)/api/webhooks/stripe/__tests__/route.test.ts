// @vitest-environment node
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const mockHandle = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/billing/stripeSync', () => ({ handleStripeWebhook: mockHandle }));

const post = (headers: Record<string, string> = { 'stripe-signature': 't=1,v1=abc' }) =>
  POST(
    new Request('https://app.biber.test/api/webhooks/stripe', {
      body: '{"id":"evt_1"}',
      headers,
      method: 'POST',
    }),
  );

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    mockHandle.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('hands Stripe the exact payload and signature, and confirms receipt', async () => {
    mockHandle.mockResolvedValue({ handled: true, type: 'invoice.paid' });

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: true, received: true, type: 'invoice.paid' });
    expect(mockHandle).toHaveBeenCalledWith(expect.anything(), '{"id":"evt_1"}', 't=1,v1=abc');
  });

  it('answers 400 to an unsigned or wrongly signed payload, so Stripe does not retry it', async () => {
    expect((await post({})).status).toBe(400);
    expect(mockHandle).not.toHaveBeenCalled();

    mockHandle.mockRejectedValue(
      new Stripe.errors.StripeSignatureVerificationError({ message: 'No signatures found' } as any),
    );
    expect((await post()).status).toBe(400);
  });

  it('answers 500 when the sync failed, so Stripe sends the event again', async () => {
    mockHandle.mockRejectedValue(new Error('database unavailable'));

    expect((await post()).status).toBe(500);
  });
});
