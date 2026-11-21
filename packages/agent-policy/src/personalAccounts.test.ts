import { describe, expect, it } from 'vitest';

import {
  isPersonalAccountToolkit,
  isReadOnlyAccountAction,
  stripToolkitPrefix,
} from './personalAccounts';

describe('mail and calendar toolkits', () => {
  it('knows the mailbox and calendar toolkits, and nothing else', () => {
    for (const id of ['gmail', 'google-calendar', 'outlook-mail', 'lobe-mail', 'lobe-calendar']) {
      expect(isPersonalAccountToolkit(id)).toBe(true);
    }
    expect(isPersonalAccountToolkit('github')).toBe(false);
  });

  it('reads the action after the Composio toolkit name', () => {
    expect(stripToolkitPrefix('GMAIL_FETCH_EMAILS')).toBe('FETCH_EMAILS');
    expect(stripToolkitPrefix('OUTLOOK_OUTLOOK_LIST_MESSAGES')).toBe('LIST_MESSAGES');
    expect(stripToolkitPrefix('searchMail')).toBe('searchMail');
  });

  it.each([
    'GMAIL_FETCH_EMAILS',
    'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
    'GOOGLECALENDAR_EVENTS_LIST',
    'GOOGLECALENDAR_FIND_FREE_SLOTS',
    'OUTLOOK_OUTLOOK_LIST_MESSAGES',
    'OUTLOOK_OUTLOOK_GET_EVENT',
    'searchMail',
    'readMail',
    'listEvents',
  ])('%s only reads', (name) => {
    expect(isReadOnlyAccountAction(name)).toBe(true);
  });

  it.each([
    'GMAIL_SEND_EMAIL',
    'GMAIL_REPLY_TO_THREAD',
    'GMAIL_CREATE_EMAIL_DRAFT',
    'GMAIL_ADD_LABEL_TO_EMAIL',
    'GMAIL_MOVE_TO_TRASH',
    'GOOGLECALENDAR_CREATE_EVENT',
    'GOOGLECALENDAR_QUICK_ADD',
    'GOOGLECALENDAR_PATCH_EVENT',
    'OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT',
    'OUTLOOK_OUTLOOK_UPDATE_EMAIL',
    'GMAIL_GET_AND_ARCHIVE',
    // Says nothing about reading: counts as a change
    'GMAIL_SYNC_HISTORY',
    'sendMail',
    'createEvent',
  ])('%s changes something', (name) => {
    expect(isReadOnlyAccountAction(name)).toBe(false);
  });
});
