import debug from 'debug';
import { Hono } from 'hono';

import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { getServerDB } from '@/database/server';
import { ProactiveService } from '@/server/services/proactive/service';

import { qstashAuth } from '../middlewares/qstashAuth';

const log = debug('lobe-server:workflows:proactive');

/** Users checked per tick; the rest wait for the next one, longest unchecked first. */
const USERS_PER_TICK = 200;

const app = new Hono();

/**
 * Biber's proactive check for every user who has something coming up, meant to be called every
 * 15 minutes by QStash or the operator's scheduler (with CRON_SECRET). Each user is checked on
 * their own: one failure does not stop the others. Returns how many checks ended which way.
 */
app.post('/tick', qstashAuth(), async (c) => {
  const db = await getServerDB();
  const now = new Date();

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

  log('tick: %d users %o', userIds.length, outcomes);
  return c.json({ checked: userIds.length, outcomes });
});

export default app;
