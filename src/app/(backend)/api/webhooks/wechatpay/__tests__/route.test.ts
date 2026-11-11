// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const { mockHandle, mockConfigured, MockWechatPayError } = vi.hoisted(() => ({
  mockConfigured: vi.fn(() => true),
  mockHandle: vi.fn(),
  MockWechatPayError: class extends Error {},
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/billing/mainland', () => ({
  handleWechatPayNotification: mockHandle,
  isWechatPayConfigured: mockConfigured,
  WechatPayError: MockWechatPayError,
}));

const post = () =>
  POST(
    new Request('https://app.biber.test/api/webhooks/wechatpay', {
      body: '{"event_type":"TRANSACTION.SUCCESS"}',
      headers: { 'wechatpay-serial': 'PUB_KEY_ID_TEST' },
      method: 'POST',
    }),
  );

describe('POST /api/webhooks/wechatpay', () => {
  beforeEach(() => {
    mockHandle.mockReset();
    mockConfigured.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('hands over the raw body with its headers and acknowledges with an empty 204', async () => {
    const response = await post();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const [, headers, body] = mockHandle.mock.calls[0];
    expect(headers.get('wechatpay-serial')).toBe('PUB_KEY_ID_TEST');
    expect(body).toBe('{"event_type":"TRANSACTION.SUCCESS"}');
  });

  it('refuses a notification WeChat Pay did not sign', async () => {
    mockHandle.mockRejectedValue(new MockWechatPayError('The message signature does not match'));

    const response = await post();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'FAIL',
      message: 'The message signature does not match',
    });
  });

  it('answers 500 when recording fails, so WeChat Pay sends it again', async () => {
    mockHandle.mockRejectedValue(new Error('database down'));

    expect((await post()).status).toBe(500);
  });

  it('answers 503 while WeChat Pay is not configured', async () => {
    mockConfigured.mockReturnValue(false);

    expect((await post()).status).toBe(503);
    expect(mockHandle).not.toHaveBeenCalled();
  });
});
