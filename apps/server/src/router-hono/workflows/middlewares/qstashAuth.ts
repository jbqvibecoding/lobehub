import { timingSafeEqual } from 'node:crypto';

import { recordUpstashWorkflowEvent } from '@lobechat/observability-otel/modules/upstash-workflow';
import { errorNameFrom } from '@lobechat/utils';
import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { verifyQStashSignature } from '@/libs/qstash';

const log = debug('lobe-server:workflows:qstash-auth');

/** Whether the request carries `Authorization: Bearer <secret>`, compared in constant time. */
const hasBearerSecret = (header: string | undefined, secret: string) => {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/**
 * Hono middleware for workflow endpoints that QStash or a scheduler calls.
 *
 * A call is let through when it carries either credential the deployment has:
 * - `Authorization: Bearer <CRON_SECRET>`, for a scheduler of the operator's own (the mainland
 *   edition has no QStash) and for the hook dispatcher's unsigned fallback;
 * - a valid `Upstash-Signature`, when `QSTASH_CURRENT_SIGNING_KEY` is set.
 *
 * With neither configured, production refuses every call: these endpoints run any user's tasks,
 * so an open endpoint lets anyone start them. Development keeps the old open behavior.
 *
 * The body is consumed via `c.req.text()` to compute the HMAC; downstream handlers can still call
 * `c.req.json()` because Hono caches across body formats.
 *
 * Use for one-shot QStash webhook receivers. For Upstash *Workflow* endpoints (multi-step `serve()`
 * integrations) use `@upstash/workflow/hono`'s built-in verification instead.
 */
export const qstashAuth = (): MiddlewareHandler => async (c, next) => {
  const cronSecret = process.env.CRON_SECRET;
  const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;

  if (cronSecret && hasBearerSecret(c.req.header('authorization'), cronSecret)) {
    log('Accepted CRON_SECRET on %s', c.req.path);
  } else if (signingKey) {
    const rawBody = await c.req.text();

    const ok = await verifyQStashSignature(c.req.raw, rawBody);
    if (!ok) {
      log('Rejected: invalid QStash signature on %s', c.req.path);
      recordUpstashWorkflowEvent({
        errorType: 'InvalidSignature',
        interface: 'qstash',
        operation: 'serve',
        path: c.req.path,
        status: 'error',
      });

      return c.json({ error: 'Invalid signature' }, 401);
    }
  } else if (cronSecret) {
    log('Rejected: missing or wrong CRON_SECRET on %s', c.req.path);
    return c.json({ error: 'Unauthorized' }, 401);
  } else if (process.env.NODE_ENV === 'production') {
    log('Rejected: neither CRON_SECRET nor QStash signing keys are set (%s)', c.req.path);
    return c.json({ error: 'Set CRON_SECRET or QStash signing keys to call workflows' }, 503);
  }

  try {
    await next();

    recordUpstashWorkflowEvent({
      interface: 'qstash',
      operation: 'serve',
      path: c.req.path,
      status: 'success',
    });
  } catch (error) {
    recordUpstashWorkflowEvent({
      errorType: errorNameFrom(error) ?? typeof error,
      interface: 'qstash',
      operation: 'serve',
      path: c.req.path,
      status: 'error',
    });

    throw error;
  }
};
