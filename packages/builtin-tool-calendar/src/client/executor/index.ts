import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { calendarService } from '@/services/calendar';

import { CalendarIdentifier } from '../../manifest';
import type {
  CreateEventParams,
  DeleteEventParams,
  FindFreeTimeParams,
  PeriodParams,
  UpdateEventParams,
} from '../../types';
import { CalendarApiName } from '../../types';

/**
 * Runs the calendar tool from the browser when the web chat executes tools there. Every call goes
 * to the server, which holds the calendar access and answers as it does when it runs the tool.
 */
class CalendarExecutor extends BaseExecutor<typeof CalendarApiName> {
  readonly identifier = CalendarIdentifier;
  protected readonly apiEnum = CalendarApiName;

  private run = async (call: () => Promise<BuiltinToolResult>): Promise<BuiltinToolResult> => {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'CalendarRequestFailed' },
        success: false,
      };
    }
  };

  createEvent = (params: CreateEventParams) => this.run(() => calendarService.createEvent(params));

  deleteEvent = (params: DeleteEventParams) => this.run(() => calendarService.deleteEvent(params));

  findFreeTime = (params: FindFreeTimeParams) =>
    this.run(() => calendarService.findFreeTime(params));

  listEvents = (params: PeriodParams) => this.run(() => calendarService.listEvents(params));

  updateEvent = (params: UpdateEventParams) => this.run(() => calendarService.updateEvent(params));
}

export const calendarExecutor = new CalendarExecutor();
