import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { expireBackgroundApprovals } from '@/server/services/toolApproval/expire';

/**
 * Cron entry point: refuses the approval requests background runs have waited on for too long
 * (see `expireBackgroundApprovals`). Run it hourly; each call handles the oldest 100.
 */
export async function expireApprovals(c: Context): Promise<Response> {
  const result = await expireBackgroundApprovals(await getServerDB());
  return c.json(result);
}
