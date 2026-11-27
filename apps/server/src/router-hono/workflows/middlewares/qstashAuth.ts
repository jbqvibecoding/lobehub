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
 * Hono middleware that verifies the `Upstash-Signature` header on incoming
 * QStash webhook calls.
 *
 * - `Authorization: Bearer <CRON_SECRET>` is accepted first, for a scheduler of
 *   the operator's own (the mainland edition has no QStash).
 * - Without QStash keys, production requires a signed internal callback.
 *   Development and Electron retain their local execution behavior.
 * - On signature mismatch, returns `401 Invalid signature` and aborts the
 *   handler chain.
 * - Read a clone so both Hono handlers and the Workflow SDK can read the body.
 *
 * Use for one-shot QStash webhook receivers. For Upstash *Workflow* endpoints
 * (multi-step `serve()` integrations) use `@upstash/workflow/hono`'s built-in
 * verification instead.
 */
export const qstashAuth = (): MiddlewareHandler => async (c, next) => {
  const cronSecret = process.env.CRON_SECRET;
  const hasCronSecret = !!cronSecret && hasBearerSecret(c.req.header('authorization'), cronSecret);
  if (hasCronSecret) log('Accepted CRON_SECRET on %s', c.req.path);

  const ok =
    hasCronSecret || (await verifyQStashSignature(c.req.raw, await c.req.raw.clone().text()));
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

/** Keep the SDK's configured verification; guard its unsigned local fallback. */
export const workflowAuth = (): MiddlewareHandler => async (c, next) => {
  if (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY) {
    await next();
    return;
  }
  return qstashAuth()(c, next);
};
