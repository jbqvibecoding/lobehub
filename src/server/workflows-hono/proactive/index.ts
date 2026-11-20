import debug from 'debug';
import { Hono } from 'hono';

import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { getServerDB } from '@/database/server';
import { deliverAskedReminders } from '@/server/services/proactive/asked';
import { ProactiveService } from '@/server/services/proactive/service';

import { qstashAuth } from '../middlewares/qstashAuth';

const log = debug('lobe-server:workflows:proactive');

/** Users checked per tick; the rest wait for the next one, longest unchecked first. */
const USERS_PER_TICK = 200;

const app = new Hono();

/**
 * Biber's proactive check, meant to be called every 5 minutes by QStash or the operator's
 * scheduler (with CRON_SECRET). First the reminders users asked for whose time has come go out,
 * then every user who has something coming up is checked on their own: one failure does not stop
 * the others. Returns how the reminders and the checks ended.
 */
app.post('/tick', qstashAuth(), async (c) => {
  const db = await getServerDB();
  const now = new Date();

  const asked = await deliverAskedReminders(db, now);
  await ProactiveMessageModel.ignoreOverdue(db, now);
  const userIds = await ProactiveService.dueUsers(db, now, USERS_PER_TICK);

  const outcomes: Record<string, number> = {};
  for (const userId of userIds) {
    let outcome: string;
    try {
      const result = await new ProactiveService(db, userId).runForUser(now);
      outcome = result.sent ? 'sent' : result.reason;
    } catch (error) {
      console.error('[proactive] check failed for userId=%s: %O', userId, error);
      outcome = 'failed';
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  log('tick: asked %o, %d users %o', asked, userIds.length, outcomes);
  return c.json({ asked, checked: userIds.length, outcomes });
});

export default app;
