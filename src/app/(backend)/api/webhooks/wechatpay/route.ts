import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  handleWechatPayNotification,
  isWechatPayConfigured,
  WechatPayError,
} from '@/server/services/billing/mainland';

const fail = (message: string, status: number) =>
  NextResponse.json({ code: 'FAIL', message }, { status });

/**
 * WeChat Pay payment notifications. An empty 204 acknowledges one; any 4xx or 5xx makes WeChat
 * Pay send it again later, which is what a failed write needs. A message WeChat Pay did not sign
 * is refused with 401.
 */
export const POST = async (req: Request): Promise<Response> => {
  if (!isWechatPayConfigured()) return fail('WeChat Pay is not configured', 503);

  const body = await req.text();
  try {
    await handleWechatPayNotification(await getServerDB(), req.headers, body);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WechatPayError) return fail(error.message, 401);
    if (error instanceof SyntaxError) return fail('Invalid JSON', 400);

    console.error('[webhooks/wechatpay] handling failed:', error);
    return fail('Notification handling failed', 500);
  }
};
