import type {
  CreateEventParams,
  DeleteEventParams,
  FindFreeTimeParams,
  PeriodParams,
  UpdateEventParams,
} from '@lobechat/builtin-tool-calendar';

import { lambdaClient } from '@/libs/trpc/client';

/** The calendar tool, run from the web chat's browser: the server holds the access and does the work. */
export const calendarService = {
  createEvent: (params: CreateEventParams) => lambdaClient.calendar.createEvent.mutate(params),

  deleteEvent: (params: DeleteEventParams) => lambdaClient.calendar.deleteEvent.mutate(params),

  findFreeTime: (params: FindFreeTimeParams) => lambdaClient.calendar.findFreeTime.query(params),

  listEvents: (params: PeriodParams) => lambdaClient.calendar.listEvents.query(params),

  updateEvent: (params: UpdateEventParams) => lambdaClient.calendar.updateEvent.mutate(params),
};
