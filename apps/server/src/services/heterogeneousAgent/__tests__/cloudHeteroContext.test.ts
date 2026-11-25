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

  it('describes the ephemeral box at /workspace when no placement is given', () => {
    const context = buildCloudHeteroContext({ repos: ['lobehub/lobehub'] });

    expect(context).toContain('Your working directory is `/workspace`');
    expect(context).toContain('This sandbox is ephemeral');
    expect(context).toContain('- `/workspace/lobehub`');
  });

  it('renders an explicit ephemeral placement exactly like no placement', () => {
    const repos = ['lobehub/lobehub'];

    expect(buildCloudHeteroContext({ repos, sandbox: { mode: 'ephemeral' } })).toBe(
      buildCloudHeteroContext({ repos }),
    );
  });

  it('describes a persistent instance by its place in the workspace, never by an absolute path', () => {
    const context = buildCloudHeteroContext({
      repos: ['lobehub/lobehub'],
      sandbox: { cwd: 'lobehub-main', mode: 'persistent' },
    });

    expect(context).toContain('Your working directory is `lobehub-main`');
    expect(context).toContain('persistent workspace');
    expect(context).toContain('- `./lobehub`');
    expect(context).not.toContain('/workspace');
    expect(context).not.toContain('ephemeral');
    // Still no credentials: the work is handed over with the run's own tools
    expect(context).toContain('Do not run `git push`');
  });
});
