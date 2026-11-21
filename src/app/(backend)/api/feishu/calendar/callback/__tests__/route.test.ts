// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

/** What finishing the authorization does in each test, and what it was given. */
const feishu = vi.hoisted(() => ({
  calls: [] as unknown[][],
  outcome: (async () => ({ label: '张三' })) as () => Promise<unknown>,
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/envs/region', () => ({ regionEnv: { APP_REGION: 'cn' } }));
vi.mock('@/server/services/calendar', () => {
  class CalendarConnectError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    CalendarConnectError,
    CalendarService: {
      completeFeishuAuth: (...args: unknown[]) => {
        feishu.calls.push(args);
        return feishu.outcome();
      },
    },
  };
});

const call = (query: string) =>
  GET(new NextRequest(`https://biber.example.cn/api/feishu/calendar/callback?${query}`));

beforeEach(() => {
  feishu.calls = [];
  feishu.outcome = async () => ({ label: '张三' });
});

describe('Feishu calendar callback', () => {
  it('connects with the code and state Feishu sent, and says so', async () => {
    const response = await call(`code=abc&state=${'a'.repeat(48)}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('已连接飞书日历');
    expect(feishu.calls).toEqual([[{}, { code: 'abc', state: 'a'.repeat(48) }]]);
  });

  it('explains an expired or reused link', async () => {
    const { CalendarConnectError } = await import('@/server/services/calendar');
    feishu.outcome = async () => {
      throw new CalendarConnectError('state', 'expired');
    };

    const response = await call(`code=abc&state=${'a'.repeat(48)}`);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('链接已失效');
  });

  it('does nothing when the user declined on Feishu', async () => {
    const response = await call('error=access_denied');

    expect(response.status).toBe(400);
    expect(feishu.calls).toHaveLength(0);
  });
});
