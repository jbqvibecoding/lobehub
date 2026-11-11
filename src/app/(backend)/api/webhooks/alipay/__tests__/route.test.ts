// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const { mockHandle, mockConfigured, MockAlipayError } = vi.hoisted(() => ({
  mockConfigured: vi.fn(() => true),
  MockAlipayError: class extends Error {},
  mockHandle: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/billing/mainland', () => ({
  AlipayError: MockAlipayError,
  handleAlipayNotification: mockHandle,
  isAlipayConfigured: mockConfigured,
}));

const post = () =>
  POST(
    new Request('https://app.biber.test/api/webhooks/alipay', {
      body: 'out_trade_no=order-2&subject=Biber+%E5%9F%BA%E7%A1%80%E7%89%88&sign=abc%2B%3D',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    }),
  );

describe('POST /api/webhooks/alipay', () => {
  beforeEach(() => {
    mockHandle.mockReset();
    mockConfigured.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('hands over the decoded form and replies `success` so Alipay stops sending it', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
    expect(mockHandle).toHaveBeenCalledWith(expect.anything(), {
      out_trade_no: 'order-2',
      sign: 'abc+=',
      subject: 'Biber 基础版',
    });
  });

  it('does not reply `success` to a notification Alipay did not sign, or that failed', async () => {
    mockHandle.mockRejectedValueOnce(new MockAlipayError('not signed'));
    const forged = await post();
    expect(forged.status).toBe(401);
    expect(await forged.text()).toBe('fail');

    mockHandle.mockRejectedValueOnce(new Error('database down'));
    expect((await post()).status).toBe(500);
  });
});
