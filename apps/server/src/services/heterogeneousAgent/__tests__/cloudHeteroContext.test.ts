import { describe, expect, it } from 'vitest';

import { buildCloudHeteroContext } from '../cloudHeteroContext';

describe('buildCloudHeteroContext', () => {
  it('says there are no credentials, and never tells the agent to push', () => {
    const context = buildCloudHeteroContext({ repos: ['owner/repo'] });

    expect(context).toContain('holds no GitHub token or other account credentials');
    expect(context).toContain('Do not run `git push`');
    expect(context).not.toMatch(/gh repo fork|GITHUB_TOKEN|~\/\.creds/);
    expect(context).toContain('`/workspace/repo`');
  });

  it('describes the workspace the run gets', () => {
    expect(buildCloudHeteroContext({ persistentWorkspace: true, repos: [] })).toContain(
      'kept between conversations',
    );
    expect(buildCloudHeteroContext({ repos: [] })).toContain('ephemeral');
  });

  it('puts the agent’s own context first and the earlier turns last', () => {
    const context = buildCloudHeteroContext({
      agentSystemContext: 'You are the coder.',
      conversationHistory: [{ content: 'Add a README', role: 'user' }],
      repos: [],
    });

    expect(context.startsWith('You are the coder.')).toBe(true);
    expect(context.endsWith('</previous_conversation>')).toBe(true);
  });
});
