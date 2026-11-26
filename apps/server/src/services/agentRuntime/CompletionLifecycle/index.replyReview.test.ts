// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as contentSafety from '@/server/services/contentSafety';
import * as verifyServices from '@/server/services/verify';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.dispatchHooks — mainland content safety on the reply', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const doneState = {
    host: { hooks: [] },
    messages: [
      { content: 'user prompt', id: 'msg-user', role: 'user' },
      { content: 'a flagged reply', id: 'msg-assistant', role: 'assistant' },
    ],
    metadata: {},
    origin: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
    status: 'done',
  };

  const setup = (verdict: 'allowed' | 'hidden') => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(verifyServices, 'runVerifyOnCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(contentSafety, 'reviewModelReply').mockResolvedValue(verdict);
    const update = vi.fn().mockResolvedValue(undefined);
    (lifecycle as any).messageModel = { findById: vi.fn(), update };
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    return { dispatch, lifecycle, update };
  };

  it('replaces a flagged reply in the store and in what chats are sent', async () => {
    const { dispatch, lifecycle, update } = setup('hidden');

    await lifecycle.dispatchHooks('op-1', doneState, 'done');

    expect(contentSafety.reviewModelReply).toHaveBeenCalledWith('a flagged reply');
    expect(update).toHaveBeenCalledWith('msg-assistant', {
      content: contentSafety.REPLY_HIDDEN_NOTICE,
    });
    expect(dispatch).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: contentSafety.REPLY_HIDDEN_NOTICE }),
      [],
    );
  });

  it('reviews a reply cut short as well: stopped, failed, or paused for an approval', async () => {
    for (const reason of ['interrupted', 'error', 'waiting_for_human']) {
      const { lifecycle, update } = setup('hidden');

      await lifecycle.dispatchHooks('op-1', { ...doneState, status: reason }, reason);

      expect(update).toHaveBeenCalledWith('msg-assistant', {
        content: contentSafety.REPLY_HIDDEN_NOTICE,
      });
      vi.restoreAllMocks();
    }
  });

  it('leaves a reply that passes untouched', async () => {
    const { dispatch, lifecycle, update } = setup('allowed');

    await lifecycle.dispatchHooks('op-1', doneState, 'done');

    expect(update).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: 'a flagged reply' }),
      [],
    );
  });
});
