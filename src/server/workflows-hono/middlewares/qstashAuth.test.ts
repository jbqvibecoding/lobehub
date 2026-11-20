import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { qstashAuth } from './qstashAuth';

const mocks = vi.hoisted(() => ({ signatureValid: false }));

vi.mock('@/libs/qstash', () => ({
  verifyQStashSignature: vi.fn(async () => mocks.signatureValid),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  recordUpstashWorkflowEvent: vi.fn(),
}));

const app = new Hono().post('/run', qstashAuth(), (c) => c.json({ ran: true }));

const call = (headers: Record<string, string> = {}) =>
  app.request('/run', { body: '{}', headers, method: 'POST' });

describe('qstashAuth', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    mocks.signatureValid = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets in a call signed by QStash', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'sig');
    mocks.signatureValid = true;

    expect((await call()).status).toBe(200);
  });

  it('lets in a scheduler that presents CRON_SECRET, with or without QStash', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await call({ authorization: 'Bearer cron-secret' })).status).toBe(200);

    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'sig');
    expect((await call({ authorization: 'Bearer cron-secret' })).status).toBe(200);
  });

  it('refuses a call with a wrong secret or a bad signature', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await call({ authorization: 'Bearer guess' })).status).toBe(401);
    expect((await call()).status).toBe(401);

    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'sig');
    expect((await call({ authorization: 'Bearer guess' })).status).toBe(401);
  });

  it('refuses every call in production when neither credential is set', async () => {
    expect((await call()).status).toBe(503);
    expect((await call({ authorization: 'Bearer anything' })).status).toBe(503);
  });

  it('stays open in development when neither credential is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect((await call()).status).toBe(200);
  });
});
