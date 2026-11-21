import { CalendarApiName, CalendarIdentifier } from '@lobechat/builtin-tool-calendar';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calendarRuntime } from '../calendar';

const mocks = vi.hoisted(() => ({
  built: [] as unknown[][],
  service: {
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    findFreeTime: vi.fn(),
    listEvents: vi.fn(),
    updateEvent: vi.fn(),
  },
}));

vi.mock('@/server/services/calendar', () => ({
  CalendarService: vi.fn().mockImplementation((...args: unknown[]) => {
    mocks.built.push(args);
    return mocks.service;
  }),
}));

const serverDB = {} as any;

describe('calendarRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.built = [];
    for (const mock of Object.values(mocks.service)) {
      mock.mockResolvedValue({ content: 'ok', success: true });
    }
  });

  it('answers every API of the manifest from the running user’s calendar', async () => {
    expect(calendarRuntime.identifier).toBe(CalendarIdentifier);
    const runtime = calendarRuntime.factory({ serverDB, userId: 'user-1' } as any);

    expect(Object.keys(runtime).sort()).toEqual(Object.values(CalendarApiName).sort());
    expect(mocks.built).toEqual([[serverDB, 'user-1']]);

    const period = { from: '2026-11-23T00:00:00+08:00', to: '2026-11-24T00:00:00+08:00' };
    await runtime.listEvents(period);
    await runtime.deleteEvent({ id: 'evt_1' });
    expect(mocks.service.listEvents).toHaveBeenCalledWith(period);
    expect(mocks.service.deleteEvent).toHaveBeenCalledWith({ id: 'evt_1' });
  });

  it('needs to know whose calendar it is', () => {
    expect(() => calendarRuntime.factory({ serverDB } as any)).toThrow('userId and serverDB');
  });
});
