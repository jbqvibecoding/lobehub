// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calendarRouter } from '../calendar';

const mocks = vi.hoisted(() => ({
  built: [] as unknown[][],
  createEvent: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/calendar', () => ({
  CalendarService: vi.fn().mockImplementation(function (...args: unknown[]) {
    mocks.built.push(args);
    return { createEvent: mocks.createEvent, listEvents: mocks.listEvents };
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.built = [];
  mocks.createEvent.mockResolvedValue({ content: 'ok', success: true });
  mocks.listEvents.mockResolvedValue({ content: 'ok', success: true });
});

describe('calendarRouter', () => {
  it('runs the web chat’s calendar calls on the signed-in user’s own calendar', async () => {
    const period = { from: '2026-11-23T00:00:00+08:00', to: '2026-11-24T00:00:00+08:00' };
    await calendarRouter.createCaller({ userId: 'user-7' } as any).listEvents(period);

    expect(mocks.built[0][1]).toBe('user-7');
    expect(mocks.listEvents).toHaveBeenCalledWith(period);
  });

  it('refuses an event inviting more than 20 people before reaching the calendar', async () => {
    const attendees = Array.from({ length: 21 }, (_, i) => `p${i}@example.com`);

    await expect(
      calendarRouter.createCaller({ userId: 'user-7' } as any).createEvent({
        attendees,
        end: '2026-11-24T16:00:00+08:00',
        start: '2026-11-24T15:00:00+08:00',
        title: 'x',
      }),
    ).rejects.toThrow();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});
