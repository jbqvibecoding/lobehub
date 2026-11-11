import { getServerDB } from '@/database/core/db-adaptor';
import {
  AlipayError,
  handleAlipayNotification,
  isAlipayConfigured,
} from '@/server/services/billing/mainland';

const text = (body: string, status = 200) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status });

/**
 * Alipay payment notifications, posted as a form. Alipay stops sending one only when the reply is
 * the text `success`; anything else is retried over the next day, which is what a failed write
 * needs.
 */
export const POST = async (req: Request): Promise<Response> => {
  if (!isAlipayConfigured()) return text('fail', 503);

  const fields = Object.fromEntries(new URLSearchParams(await req.text()));
  try {
    await handleAlipayNotification(await getServerDB(), fields);
    return text('success');
  } catch (error) {
    if (error instanceof AlipayError) return text('fail', 401);

    console.error('[webhooks/alipay] handling failed:', error);
    return text('fail', 500);
  }
};
