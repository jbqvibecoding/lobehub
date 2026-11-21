import { CalendarApiName } from '@lobechat/builtin-tool-calendar';
import { calendarExecutor } from '@lobechat/builtin-tool-calendar/client/executor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createEvent: vi.fn(), listEvents: vi.fn() }));

vi.mock('@/services/calendar', () => ({
  calendarService: { createEvent: mocks.createEvent, listEvents: mocks.listEvents },
}));

describe('calendarExecutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands each call to the server, which holds the calendar access', async () => {
    const answer = { content: 'Created “Review”.', success: true };
    mocks.createEvent.mockResolvedValue(answer);
    const params = {
      end: '2026-11-24T16:00:00+08:00',
      start: '2026-11-24T15:00:00+08:00',
      title: 'Review',
    };

    expect(await calendarExecutor.invoke(CalendarApiName.createEvent, params, {} as any)).toEqual(
      answer,
    );
    expect(mocks.createEvent).toHaveBeenCalledWith(params);
  });

  it('turns a failed request into an error the model can read', async () => {
    mocks.listEvents.mockRejectedValue(new Error('network down'));

    const result = await calendarExecutor.invoke(
      CalendarApiName.listEvents,
      { from: 'a', to: 'b' },
      {} as any,
    );

    expect(result).toEqual({
      content: 'network down',
      error: { message: 'network down', type: 'CalendarRequestFailed' },
      success: false,
    });
  });
});
