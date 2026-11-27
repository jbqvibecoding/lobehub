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
    mocks.signatureValid = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets in a call the signature check accepts (QStash or a signed internal callback)', async () => {
    mocks.signatureValid = true;

    expect((await call()).status).toBe(200);
  });

  it('lets in a scheduler that presents CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    expect((await call({ authorization: 'Bearer cron-secret' })).status).toBe(200);
  });

  it('refuses a wrong secret, or a bearer when no CRON_SECRET is set, unless signed', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await call({ authorization: 'Bearer guess' })).status).toBe(401);
    expect((await call()).status).toBe(401);

    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
  });
});
