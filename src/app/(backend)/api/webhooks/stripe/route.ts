import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getServerDB } from '@/database/core/db-adaptor';
import { handleStripeWebhook } from '@/server/services/billing/stripeSync';

/**
 * Stripe's webhook endpoint. The status code tells Stripe what to do next: 400 for a payload it
 * did not sign (retrying cannot help), 500 when our sync failed (Stripe retries with backoff).
 */
export const POST = async (req: Request): Promise<NextResponse> => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe-Signature header' }, { status: 400 });
  }

  // The signature covers the exact bytes Stripe sent, so read the body unparsed
  const payload = await req.text();

  try {
    const result = await handleStripeWebhook(await getServerDB(), payload, signature);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.error('[webhooks/stripe] handling failed:', error);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }
};
