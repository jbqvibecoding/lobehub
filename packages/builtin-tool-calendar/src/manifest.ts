import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CalendarApiName } from './types';

export const CalendarIdentifier = 'lobe-calendar';

const MOMENT = {
  description: 'ISO 8601 date and time with its UTC offset, e.g. 2026-11-25T15:00:00+08:00',
  type: 'string',
} as const;

const PERIOD = {
  from: { ...MOMENT, description: `Start of the period. ${MOMENT.description}` },
  to: {
    ...MOMENT,
    description: `End of the period, at most 31 days after from. ${MOMENT.description}`,
  },
} as const;

export const CalendarManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "List the events on the user's calendar in a period, with ids, and the current time in the user's time zone.",
      name: CalendarApiName.listEvents,
      parameters: {
        additionalProperties: false,
        properties: PERIOD,
        required: ['from', 'to'],
        type: 'object',
      },
    },
    {
      description:
        'Find the free time between events in a period, in gaps of at least some minutes.',
      name: CalendarApiName.findFreeTime,
      parameters: {
        additionalProperties: false,
        properties: {
          ...PERIOD,
          minutes: {
            description: 'Shortest gap worth listing; 30 if not given',
            minimum: 5,
            type: 'integer',
          },
        },
        required: ['from', 'to'],
        type: 'object',
      },
    },
    {
      description:
        "Create an event on the user's calendar and invite people by mail. The user approves it first.",
      humanIntervention: 'required',
      name: CalendarApiName.createEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          attendees: {
            description: 'Mail addresses to invite, at most 20',
            items: { type: 'string' },
            maxItems: 20,
            type: 'array',
          },
          description: { description: 'Notes for the event', type: 'string' },
          end: { ...MOMENT, description: `When it ends. ${MOMENT.description}` },
          location: { description: 'Where it takes place, or a meeting link', type: 'string' },
          start: { ...MOMENT, description: `When it starts. ${MOMENT.description}` },
          title: { description: 'What the event is, in a few words', type: 'string' },
        },
        required: ['title', 'start', 'end'],
        type: 'object',
      },
    },
    {
      description:
        'Change an event: its title, time, place or notes. Give start and end together to move it. The user approves it first.',
      humanIntervention: 'required',
      name: CalendarApiName.updateEvent,
      parameters: {
        additionalProperties: false,
        properties: {
          description: { description: 'New notes', type: 'string' },
          end: { ...MOMENT, description: `New end. ${MOMENT.description}` },
          id: { description: 'The id listEvents gave', type: 'string' },
          location: { description: 'New place', type: 'string' },
          start: { ...MOMENT, description: `New start. ${MOMENT.description}` },
          title: { description: 'New title', type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description: 'Delete an event; attendees are told. The user approves it first.',
      humanIntervention: 'required',
      name: CalendarApiName.deleteEvent,
      parameters: {
        additionalProperties: false,
        properties: { id: { description: 'The id listEvents gave', type: 'string' } },
        required: ['id'],
        type: 'object',
      },
    },
  ],
  identifier: CalendarIdentifier,
  meta: {
    avatar: '📅',
    description: "Read and change the user's calendar",
    title: 'Calendar',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
