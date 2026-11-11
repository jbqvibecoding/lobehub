import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  AppleJwsError,
  handleAppleNotification,
  isAppleConfigured,
} from '@/server/services/billing/apple';

/**
 * App Store Server Notifications (V2). The status code tells Apple what to do next: 400 for a
 * payload Apple did not sign (retrying cannot help), 500 when our sync failed (Apple retries).
 */
export const POST = async (req: Request): Promise<NextResponse> => {
  if (!isAppleConfigured()) {
    return NextResponse.json({ error: 'The App Store is not configured' }, { status: 503 });
  }

  let signedPayload: unknown;
  try {
    ({ signedPayload } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof signedPayload !== 'string') {
    return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 });
  }

  try {
    await handleAppleNotification(await getServerDB(), signedPayload);
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof AppleJwsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('[webhooks/apple] handling failed:', error);
    return NextResponse.json({ error: 'Notification handling failed' }, { status: 500 });
  }
};
