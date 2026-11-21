export const CalendarApiName = {
  /** A new event, after the user approves it */
  createEvent: 'createEvent',

  /** Delete an event, after the user approves it */
  deleteEvent: 'deleteEvent',

  /** Free time between events */
  findFreeTime: 'findFreeTime',

  /** Events in a period, and the current time */
  listEvents: 'listEvents',

  /** Change an event, after the user approves it */
  updateEvent: 'updateEvent',
} as const;

export type CalendarApiNameType = (typeof CalendarApiName)[keyof typeof CalendarApiName];

export interface PeriodParams {
  from: string;
  to: string;
}

export interface FindFreeTimeParams extends PeriodParams {
  minutes?: number;
}

export interface CreateEventParams {
  attendees?: string[];
  description?: string;
  end: string;
  location?: string;
  start: string;
  title: string;
}

export interface UpdateEventParams {
  description?: string;
  end?: string;
  id: string;
  location?: string;
  start?: string;
  title?: string;
}

export interface DeleteEventParams {
  id: string;
}
