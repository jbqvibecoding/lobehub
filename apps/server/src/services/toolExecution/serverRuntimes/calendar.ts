import type {
  CreateEventParams,
  DeleteEventParams,
  FindFreeTimeParams,
  PeriodParams,
  UpdateEventParams,
} from '@lobechat/builtin-tool-calendar';
import { CalendarIdentifier } from '@lobechat/builtin-tool-calendar';

import { CalendarService } from '@/server/services/calendar';

import { type ServerRuntimeRegistration } from './types';

/** The calendar tool wherever the server runs tools: phone chat, chat apps, tasks, the gateway. */
export const calendarRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Calendar tool execution');
    }
    const calendar = new CalendarService(context.serverDB, context.userId);

    return {
      createEvent: (args: CreateEventParams) => calendar.createEvent(args),
      deleteEvent: (args: DeleteEventParams) => calendar.deleteEvent(args),
      findFreeTime: (args: FindFreeTimeParams) => calendar.findFreeTime(args),
      listEvents: (args: PeriodParams) => calendar.listEvents(args),
      updateEvent: (args: UpdateEventParams) => calendar.updateEvent(args),
    };
  },
  identifier: CalendarIdentifier,
};
