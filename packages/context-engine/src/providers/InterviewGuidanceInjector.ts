import type { UserProfileEntry, UserProfileSection } from '@lobechat/types';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:InterviewGuidanceInjector');

export interface InterviewGuidanceInjectorConfig {
  /** This conversation is the user's "About you" interview */
  enabled?: boolean;
  /** The profile so far, to tell what is left to ask */
  entries?: UserProfileEntry[];
  /** When Biber last finished the interview; it carries on only if the user wants to */
  finishedAt?: string;
}

/** What each section asks, in the order the interview goes. */
const QUESTIONS: Record<UserProfileSection, string> = {
  challenges: 'the biggest thing standing in their way',
  goals: 'one to three things they want to achieve, with a number or a date where there is one',
  ideal: 'where they would like to be in a year',
  mission: 'what they are about, in a sentence',
  name: 'what they would like you to call them',
  now: 'where things stand for them right now',
  people: 'the people who matter most to them: a name and who they are',
  projects: 'what they are working on at the moment',
  style: 'how they would like you to talk to them (short or detailed, gentle or blunt, …)',
};

/** The interview's order: who they are, what they want, what is in the way, then their life now. */
export const INTERVIEW_ORDER: UserProfileSection[] = [
  'name',
  'mission',
  'goals',
  'challenges',
  'people',
  'projects',
  'now',
  'ideal',
  'style',
];

/**
 * How Biber runs the "About you" interview. The rules are adapted from LifeOS's TELOS interview
 * (MIT, Daniel Miessler): one question at a time, say back what you heard before saving it, any
 * "skip" or "enough" takes effect at once, and what is already there is asked about, not replaced.
 */
export const formatInterviewGuidance = ({
  entries = [],
  finishedAt,
}: Pick<InterviewGuidanceInjectorConfig, 'entries' | 'finishedAt'>) => {
  const filled = new Set(
    entries.filter((entry) => entry.status === 'active').map((entry) => entry.section),
  );
  const done = INTERVIEW_ORDER.filter((section) => filled.has(section));
  const left = INTERVIEW_ORDER.filter((section) => !filled.has(section));

  const steps = INTERVIEW_ORDER.map(
    (section, index) => `${index + 1}. ${section}: ${QUESTIONS[section]}`,
  ).join('\n');

  const state = [
    `Already in the profile: ${done.length ? done.join(', ') : 'nothing yet'}.`,
    `Still to ask: ${left.length ? left.join(', ') : 'nothing; only check that what is there still holds'}.`,
  ].join('\n');

  const opening = finishedAt
    ? `This conversation is the user's "About you" interview, which you finished on ${finishedAt.slice(0, 10)}. Talk with them as usual. If they want to carry on with it, go on with what is still to ask, by the rules below, and finish the same way.`
    : `This conversation is the user's "About you" interview: a short talk, about five minutes, in which you get to know them so you can help them better. Speak their language. If this is the start, greet them in one sentence and ask the first question still to ask.`;

  return `<profile_interview>
${opening}

How to run it:
- Ask one thing at a time, in plain words, and wait for the answer.
- When they answer, say back in a few words what you understood and save it with saveEntry, in their words, briefly. If you got it wrong they will say so; then fix it.
- For goals, ask for a number or a date if there could be one ("by when?"), and take whatever answer they give.
- "Skip", "next", "later", "that's enough" and the like take effect at once: move on, or finish.
- What is already in the profile is not replaced: ask whether it still holds, and change it with its id only if they say it has changed.
- Do not ask about traumas or hard times. Keep health and money out unless they bring them up and want them kept.
- Keep your own turns short; this is about them.

The order:
${steps}

${state}

To finish, when everything is asked or they want to stop: list in a few short lines what you saved, tell them they can change any of it in the Biber app under Account → About you, or come back to this conversation to carry on, then call finishInterview.
</profile_interview>`;
};

/**
 * Interview Guidance Injector
 * In the user's "About you" interview only, tells Biber how to run it and what is left to ask
 */
export class InterviewGuidanceInjector extends BaseFirstUserContentProvider {
  readonly name = 'InterviewGuidanceInjector';

  constructor(
    private config: InterviewGuidanceInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    if (!this.config.enabled) return null;
    log('Interview guidance prepared (finished: %s)', !!this.config.finishedAt);
    return formatInterviewGuidance(this.config);
  }
}
