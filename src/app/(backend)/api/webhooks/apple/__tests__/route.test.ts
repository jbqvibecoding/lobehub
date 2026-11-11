// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const { mockHandle, mockConfigured, MockJwsError } = vi.hoisted(() => ({
  mockConfigured: vi.fn(() => true),
  mockHandle: vi.fn(),
  MockJwsError: class extends Error {},
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/billing/apple', () => ({
  AppleJwsError: MockJwsError,
  handleAppleNotification: mockHandle,
  isAppleConfigured: mockConfigured,
}));

const post = (body: string) =>
  POST(new Request('https://app.biber.test/api/webhooks/apple', { body, method: 'POST' }));

describe('POST /api/webhooks/apple', () => {
  beforeEach(() => {
    mockHandle.mockReset();
    mockConfigured.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it("hands Apple's signed payload over and confirms receipt", async () => {
    const response = await post('{"signedPayload":"a.b.c"}');

    expect(response.status).toBe(200);
    expect(mockHandle).toHaveBeenCalledWith(expect.anything(), 'a.b.c');
  });

  it('answers 400 to a payload Apple did not sign, so Apple does not retry it', async () => {
    mockHandle.mockRejectedValue(new MockJwsError('Signature does not match'));

    expect((await post('{"signedPayload":"a.b.c"}')).status).toBe(400);
    expect((await post('{"other":1}')).status).toBe(400);
  });

  it('answers 500 when recording fails, so Apple retries', async () => {
    mockHandle.mockRejectedValue(new Error('database unavailable'));

    expect((await post('{"signedPayload":"a.b.c"}')).status).toBe(500);
  });

  it('answers 503 while the App Store is not configured', async () => {
    mockConfigured.mockReturnValue(false);

    expect((await post('{"signedPayload":"a.b.c"}')).status).toBe(503);
    expect(mockHandle).not.toHaveBeenCalled();
  });
});
