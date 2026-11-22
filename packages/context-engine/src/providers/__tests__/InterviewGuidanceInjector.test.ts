import type { UserProfileEntry } from '@lobechat/types';
import { USER_PROFILE_SECTIONS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import {
  formatInterviewGuidance,
  INTERVIEW_ORDER,
  InterviewGuidanceInjector,
} from '../InterviewGuidanceInjector';

const entry = (id: string, section: UserProfileEntry['section']): UserProfileEntry => ({
  id,
  section,
  status: 'active',
  text: 'x',
  updatedAt: '2026-11-01T08:00:00.000Z',
});

const chat = (): PipelineContext => ({
  initialState: { messages: [], model: 'gpt-4', provider: 'openai' },
  isAborted: false,
  messages: [
    { content: 'System prompt', id: 'sys-1', role: 'system' },
    { content: 'Let’s start', id: 'user-1', role: 'user' },
  ],
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

describe('InterviewGuidanceInjector', () => {
  it('asks every section, name first and style last', () => {
    expect([...INTERVIEW_ORDER].sort()).toEqual([...USER_PROFILE_SECTIONS].sort());
    expect(INTERVIEW_ORDER[0]).toBe('name');
    expect(INTERVIEW_ORDER.at(-1)).toBe('style');
  });

  it('runs only in the interview conversation', async () => {
    const off = await new InterviewGuidanceInjector({ enabled: false }).process(chat());
    expect(off.messages).toHaveLength(2);

    const on = await new InterviewGuidanceInjector({ enabled: true }).process(chat());
    expect(on.messages).toHaveLength(3);
    expect(on.messages[1].content).toContain('<profile_interview>');
    expect(on.messages[1].content).toContain('Ask one thing at a time');
    expect(on.messages[1].content).toContain('then call finishInterview');
  });

  it('lists what is already there and what is still to ask, in order', () => {
    const text = formatInterviewGuidance({
      entries: [
        entry('G0', 'goals'),
        entry('name', 'name'),
        { ...entry('PE0', 'people'), status: 'dropped' },
      ],
    });

    expect(text).toContain('Already in the profile: name, goals.');
    expect(text).toContain(
      'Still to ask: mission, challenges, people, projects, now, ideal, style.',
    );
    expect(formatInterviewGuidance({})).toContain('Already in the profile: nothing yet.');
  });

  it('after the interview is finished, carries on only if the user wants to', () => {
    const text = formatInterviewGuidance({ finishedAt: '2026-11-20T09:00:00.000Z' });

    expect(text).toContain('which you finished on 2026-11-20');
    expect(text).toContain('If they want to carry on');
    expect(text).not.toContain('If this is the start');
  });
});
