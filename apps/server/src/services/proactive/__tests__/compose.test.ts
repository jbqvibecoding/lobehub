import type { ProactiveThoughtItem } from '@lobechat/database/schemas';
import { describe, expect, it } from 'vitest';

import { buildComposePrompt, readComposeReply } from '../compose';

const thought = {
  id: 'thought-1',
  kind: 'reminder',
  occursAt: new Date('2026-11-21T02:00:00Z'),
  seed: 'Dentist appointment',
} as ProactiveThoughtItem;

describe('buildComposePrompt', () => {
  it('gives each item’s time in the user’s time zone and lists what was said lately', () => {
    const prompt = buildComposePrompt({
      candidates: [thought],
      locale: 'en-US',
      now: new Date('2026-11-20T06:00:00Z'),
      recent: ['Your flight leaves at 8.'],
      timeZone: 'Asia/Shanghai',
    });

    expect(prompt).toContain('- id: thought-1');
    expect(prompt).toContain('kind: reminder (coming up)');
    expect(prompt).toContain('about: Dentist appointment');
    expect(prompt).toMatch(/when: Sat, Nov 21, 10:00/);
    expect(prompt).toContain('- Your flight leaves at 8.');
  });
});

describe('readComposeReply', () => {
  it('keeps a message about an offered item', () => {
    expect(
      readComposeReply({ content: ' Dentist at 10. ', skip: false, thoughtId: 'thought-1' }, [
        thought,
      ]),
    ).toEqual({ content: 'Dentist at 10.', skip: false, thoughtId: 'thought-1' });
  });

  it('treats a skip, an empty message, or an item that was not offered as a skip', () => {
    expect(readComposeReply({ content: '', skip: true, thoughtId: '' }, [thought])).toEqual({
      skip: true,
    });
    expect(
      readComposeReply({ content: '  ', skip: false, thoughtId: 'thought-1' }, [thought]),
    ).toEqual({ skip: true });
    expect(
      readComposeReply({ content: 'Hi', skip: false, thoughtId: 'made-up' }, [thought]),
    ).toEqual({ skip: true });
  });

  it('cuts a long message to chat length', () => {
    const reply = readComposeReply(
      { content: 'x'.repeat(500), skip: false, thoughtId: 'thought-1' },
      [thought],
    );

    expect(reply.skip === false && reply.content.length).toBe(300);
  });
});
