// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { personalAccounts, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GithubConnectionError, GithubConnectionService, type PushedFile } from '../index';

// A key of the App's own, made before the env mock below is evaluated
const { privateKey } = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
});

vi.mock('@/envs/github', () => ({
  githubAppEnv: {
    GITHUB_API_URL: 'https://api.github.test',
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'client-secret',
    GITHUB_APP_ID: '4242',
    // Line breaks written as \n, as an env file holds them
    GITHUB_APP_PRIVATE_KEY: privateKey
      .export({ format: 'pem', type: 'pkcs1' })
      .toString()
      .replaceAll('\n', '\\n'),
    GITHUB_APP_SLUG: 'biber-dev',
    GITHUB_WEB_URL: 'https://github.test',
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (text: string) => ({ plaintext: text.replace(/^enc:/, '') }),
      encrypt: async (text: string) => `enc:${text}`,
    }),
  },
}));

/** A GitHub with one installation (77) on one repository, acme/app. */
const github = {
  calls: [] as { auth?: string; body?: any; method: string; path: string }[],
  userInstallations: [77],
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }, status });

const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
  const path = `${url.pathname}${url.search}`;
  github.calls.push({ auth, body, method, path });

  if (url.host === 'github.test' && url.pathname === '/login/oauth/access_token') {
    return json(body.code === 'good-code' ? { access_token: 'user-token' } : { error: 'bad' });
  }
  if (path === '/user/installations?per_page=100') {
    return json({ installations: github.userInstallations.map((id) => ({ id })) });
  }
  if (path === '/app/installations/77')
    return json({ account: { login: 'acme', type: 'Organization' } });
  if (path === '/app/installations/77/access_tokens') return json({ token: 'installation-token' });
  if (url.pathname === '/installation/repositories') {
    return json({
      repositories: [{ default_branch: 'main', full_name: 'acme/app', private: true }],
    });
  }
  if (path === '/repos/acme/app/commits/main') return json({ sha: 'a'.repeat(40) });
  if (path === `/repos/acme/app/tarball/${'a'.repeat(40)}`) {
    return new Response(null, {
      headers: { location: 'https://codeload.github.test/acme/app/legacy.tar.gz/main?token=short' },
      status: 302,
    });
  }
  if (path === `/repos/acme/app/git/commits/${'a'.repeat(40)}`)
    return json({ tree: { sha: 'tree-0' } });
  if (path === '/repos/acme/app/git/blobs') return json({ sha: `blob-${github.calls.length}` });
  if (path === '/repos/acme/app/git/trees') return json({ sha: 'tree-1' });
  if (path === '/repos/acme/app/git/commits') return json({ sha: 'c'.repeat(40) });
  if (path === '/repos/acme/app/git/refs') return json({ ref: body.ref }, 201);
  if (path === '/repos/acme/app/pulls') {
    return json({ html_url: 'https://github.test/acme/app/pull/5', number: 5 }, 201);
  }
  return json({ message: 'Not Found' }, 404);
});

let db: LobeChatDatabase;
const userId = 'github-user';
const strangerId = 'github-stranger';

const connect = async () => {
  const url = new URL(await new GithubConnectionService(db, userId).connectUrl());
  return GithubConnectionService.completeConnection(db, {
    code: 'good-code',
    installationId: 77,
    state: url.searchParams.get('state')!,
  });
};

const files: PushedFile[] = [
  { content: Buffer.from('# App\n').toString('base64'), path: 'README.md', status: 'modified' },
  {
    content: Buffer.from('#!/bin/sh\n').toString('base64'),
    mode: '100755',
    path: 'bin/run',
    status: 'added',
  },
  { path: 'old.txt', status: 'deleted' },
];

const request = {
  baseRef: 'main',
  baseSha: 'a'.repeat(40),
  body: 'Explains the app.',
  files,
  operationId: 'op-1',
  repository: 'acme/app',
  title: 'Add a README',
};

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(personalAccounts);
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: strangerId }]);
  github.calls = [];
  github.userInstallations = [77];
  vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connecting GitHub', () => {
  it('keeps the installation for the user whose state it is, once, with nothing secret stored', async () => {
    const url = new URL(await new GithubConnectionService(db, userId).connectUrl());
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://github.test/apps/biber-dev/installations/new',
    );
    const state = url.searchParams.get('state')!;

    await expect(
      GithubConnectionService.completeConnection(db, {
        code: 'good-code',
        installationId: 77,
        state,
      }),
    ).resolves.toEqual({ login: 'acme' });
    await expect(
      GithubConnectionService.completeConnection(db, {
        code: 'good-code',
        installationId: 77,
        state,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const [account] = await db.select().from(personalAccounts);
    expect(account).toMatchObject({
      credentials: 'enc:{}',
      kind: 'code',
      label: 'acme',
      provider: 'github',
      settings: { accountType: 'Organization', installationId: 77 },
      userId,
    });
    // The App's own token, signed with its key, for the installation lookup
    const appCall = github.calls.find((call) => call.path === '/app/installations/77')!;
    expect(decodeJwt(appCall.auth!.replace('Bearer ', ''))).toMatchObject({ iss: '4242' });
  });

  it('refuses an installation the user cannot use, whatever id they send', async () => {
    github.userInstallations = [12];
    await expect(connect()).rejects.toBeInstanceOf(GithubConnectionError);
    expect(await db.select().from(personalAccounts)).toHaveLength(0);
  });

  it('shows the account and its repositories, and forgets it on disconnect', async () => {
    const service = new GithubConnectionService(db, userId);
    expect(await service.status()).toEqual({ available: true, connected: false });

    await connect();
    expect(await service.status()).toEqual({
      available: true,
      connected: true,
      login: 'acme',
      repositories: ['acme/app'],
    });
    expect(await new GithubConnectionService(db, strangerId).status()).toMatchObject({
      connected: false,
    });

    expect(await service.disconnect()).toBeTruthy();
    expect(await service.status()).toMatchObject({ connected: false });
  });
});

describe('a coding run and the user’s repositories', () => {
  it('opens a repository the user gave Biber as GitHub’s short-lived download, not a token', async () => {
    await connect();

    const opened = await new GithubConnectionService(db, userId).openRepository('acme/app');

    expect(opened).toEqual({
      baseRef: 'main',
      baseSha: 'a'.repeat(40),
      repository: 'acme/app',
      tarballUrl: 'https://codeload.github.test/acme/app/legacy.tar.gz/main?token=short',
    });
    // The installation token, narrowed to that repository
    expect(
      github.calls.findLast((call) => call.path === '/app/installations/77/access_tokens')?.body,
    ).toMatchObject({ repositories: ['app'] });
    expect(JSON.stringify(opened)).not.toContain('installation-token');
  });

  it('refuses a repository the user did not give, or before GitHub is connected', async () => {
    await expect(
      new GithubConnectionService(db, userId).openRepository('acme/app'),
    ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });

    await connect();
    await expect(
      new GithubConnectionService(db, userId).openRepository('someone/else'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps a push until approved, then commits exactly it on a new branch and opens a pull request', async () => {
    await connect();
    const service = new GithubConnectionService(db, userId);

    const summary = await service.requestPush('toolu_push', request);
    expect(summary).toMatchObject({
      files: 'README.md (modified), bin/run (added), old.txt (deleted)',
      pullRequest: 'Add a README',
      repository: 'acme/app',
    });
    expect(summary.branch).toMatch(/^biber\/add-a-readme-[\da-f]{6}$/);
    expect(github.calls.some((call) => call.method === 'POST' && call.path.includes('/git/'))).toBe(
      false,
    );

    const pushed = await service.push('toolu_push');

    expect(pushed).toEqual({
      branch: summary.branch,
      commit: 'c'.repeat(40),
      pullRequestUrl: 'https://github.test/acme/app/pull/5',
    });
    const tree = github.calls.find((call) => call.path === '/repos/acme/app/git/trees')!.body;
    expect(tree.base_tree).toBe('tree-0');
    expect(tree.tree).toEqual([
      expect.objectContaining({ mode: '100644', path: 'README.md' }),
      expect.objectContaining({ mode: '100755', path: 'bin/run' }),
      { mode: '100644', path: 'old.txt', sha: null, type: 'blob' },
    ]);
    expect(github.calls.find((call) => call.path === '/repos/acme/app/git/commits')!.body).toEqual({
      message: 'Add a README\n\nExplains the app.',
      parents: ['a'.repeat(40)],
      tree: 'tree-1',
    });
    expect(github.calls.find((call) => call.path === '/repos/acme/app/git/refs')!.body).toEqual({
      ref: `refs/heads/${summary.branch}`,
      sha: 'c'.repeat(40),
    });
    expect(github.calls.find((call) => call.path === '/repos/acme/app/pulls')!.body).toMatchObject({
      base: 'main',
      head: summary.branch,
    });
    // Pushed once: a second approval of the same call has nothing left
    await expect(service.push('toolu_push')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a push outside the repository, into git’s own folder, or of nothing', async () => {
    await connect();
    const service = new GithubConnectionService(db, userId);

    for (const path of ['../escape', '/etc/passwd', '.git/config', 'a//b']) {
      await expect(
        service.requestPush('toolu_bad', {
          ...request,
          files: [{ content: 'eA==', path, status: 'added' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      service.requestPush('toolu_none', { ...request, files: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('drops a declined push, and keeps each user’s pushes apart', async () => {
    await connect();
    const service = new GithubConnectionService(db, userId);
    await service.requestPush('toolu_decline', request);

    expect(
      await new GithubConnectionService(db, strangerId).pendingPush('toolu_decline'),
    ).toBeUndefined();
    await service.declinePush('toolu_decline');
    expect(await service.pendingPush('toolu_decline')).toBeUndefined();
  });
});
