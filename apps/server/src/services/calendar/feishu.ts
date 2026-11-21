import { z } from 'zod';

/**
 * Feishu's calendar API (v4), called as the user with their own token: their primary calendar,
 * its events in a period with repeats expanded, and creating, changing and deleting events.
 * Responses are checked before use; Feishu answers `{ code, msg, data }` with code 0 on success.
 */

export const FEISHU_OPEN_API = 'https://open.feishu.cn/open-apis';
const TIMEOUT_MS = 15_000;

/** A Feishu error, with its code: 99991668 and 99991677 mean the user's token is no longer valid. */
export class FeishuApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'FeishuApiError';
    this.code = code;
  }

  get tokenInvalid() {
    return [99_991_663, 99_991_668, 99_991_677, 20_005, 20_026].includes(this.code);
  }
}

const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.number(), data: data.optional(), msg: z.string().optional() });

const moment = z.object({
  date: z.string().optional(),
  timestamp: z.string().optional(),
  timezone: z.string().optional(),
});

const eventSchema = z.object({
  description: z.string().optional(),
  end_time: moment,
  event_id: z.string(),
  free_busy_status: z.string().optional(),
  location: z.object({ name: z.string().optional() }).optional(),
  start_time: moment,
  status: z.string().optional(),
  summary: z.string().optional(),
});

export type FeishuEvent = z.infer<typeof eventSchema>;

const call = async <T extends z.ZodTypeAny>(
  token: string,
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST',
  path: string,
  schema: T,
  body?: unknown,
): Promise<z.infer<T> | undefined> => {
  const response = await fetch(`${FEISHU_OPEN_API}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await response.json().catch(() => ({}));
  const parsed = envelope(schema).safeParse(json);
  if (!parsed.success) {
    throw new FeishuApiError(response.status, `Feishu answered ${response.status} unexpectedly`);
  }
  if (parsed.data.code !== 0) {
    throw new FeishuApiError(
      parsed.data.code,
      parsed.data.msg ?? `Feishu error ${parsed.data.code}`,
    );
  }
  return parsed.data.data;
};

const seconds = (when: Date) => String(Math.floor(when.getTime() / 1000));

/** A moment Feishu reads: a timestamp in seconds with the zone it is shown in. */
const at = (when: Date, timeZone: string) => ({ timestamp: seconds(when), timezone: timeZone });

export interface FeishuEventInput {
  description?: string;
  end?: Date;
  location?: string;
  start?: Date;
  title?: string;
}

/** The user's calendar on Feishu, with their token. */
export const feishuCalendar = (token: string) => ({
  /** The id of the user's own (primary) calendar. */
  primaryCalendarId: async () => {
    const data = await call(
      token,
      'POST',
      '/calendar/v4/calendars/primary',
      z.object({
        calendars: z.array(z.object({ calendar: z.object({ calendar_id: z.string() }) })),
      }),
    );
    const id = data?.calendars[0]?.calendar.calendar_id;
    if (!id) throw new FeishuApiError(-1, 'Feishu returned no primary calendar');
    return id;
  },

  /** Events between two moments, repeats expanded into their occurrences. */
  listEvents: async (calendarId: string, from: Date, to: Date) => {
    const query = new URLSearchParams({ end_time: seconds(to), start_time: seconds(from) });
    const data = await call(
      token,
      'GET',
      `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/instance_view?${query}`,
      z.object({ items: z.array(eventSchema).optional() }),
    );
    return data?.items ?? [];
  },

  createEvent: async (
    calendarId: string,
    event: Required<Pick<FeishuEventInput, 'end' | 'start' | 'title'>> & FeishuEventInput,
    timeZone: string,
  ) => {
    const data = await call(
      token,
      'POST',
      `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      z.object({ event: eventSchema }),
      {
        description: event.description,
        end_time: at(event.end, timeZone),
        location: event.location ? { name: event.location } : undefined,
        need_notification: true,
        start_time: at(event.start, timeZone),
        summary: event.title,
      },
    );
    if (!data?.event) throw new FeishuApiError(-1, 'Feishu returned no event');
    return data.event;
  },

  /** Invites people by mail address; Feishu mails those outside the user's organization. */
  inviteByMail: async (calendarId: string, eventId: string, addresses: string[]) => {
    if (addresses.length === 0) return;
    await call(
      token,
      'POST',
      `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/attendees?user_id_type=open_id`,
      z.unknown(),
      {
        attendees: addresses.map((address) => ({
          third_party_email: address,
          type: 'third_party',
        })),
        need_notification: true,
      },
    );
  },

  updateEvent: async (
    calendarId: string,
    eventId: string,
    event: FeishuEventInput,
    timeZone: string,
  ) => {
    const data = await call(
      token,
      'PATCH',
      `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      z.object({ event: eventSchema }),
      {
        ...(event.description !== undefined && { description: event.description }),
        ...(event.end && { end_time: at(event.end, timeZone) }),
        ...(event.location !== undefined && { location: { name: event.location } }),
        need_notification: true,
        ...(event.start && { start_time: at(event.start, timeZone) }),
        ...(event.title !== undefined && { summary: event.title }),
      },
    );
    if (!data?.event) throw new FeishuApiError(-1, 'Feishu returned no event');
    return data.event;
  },

  deleteEvent: async (calendarId: string, eventId: string) => {
    await call(
      token,
      'DELETE',
      `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?need_notification=true`,
      z.unknown(),
    );
  },
});

/** When an event starts or ends: a timestamp, or a whole day as a date. */
export const momentOf = (value: FeishuEvent['start_time']) => {
  if (value.timestamp) return { allDay: false, at: new Date(Number(value.timestamp) * 1000) };
  if (value.date) return { allDay: true, at: new Date(`${value.date}T00:00:00Z`) };
  return undefined;
};
