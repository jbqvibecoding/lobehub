/**
 * The user's GitHub, as the coding expert reaches it: through the Biber GitHub App, installed by
 * the user on the repositories they choose.
 *
 * - Connecting: the phone opens the App's install page with a fresh `state`; GitHub sends the user
 *   back with the installation and an OAuth code, and the installation is kept only when that code
 *   shows the user may use it.
 * - Opening a repository: the run gets a download link for one snapshot, good for a few minutes;
 *   no token reaches the coding computer.
 * - Pushing: the run uploads what it changed; the user approves on the phone, seeing the
 *   repository, the new branch, the pull request title and the files; then the server makes the
 *   commit on a new `biber/...` branch and opens a pull request. Never the default branch, never a
 *   force push, and what is pushed is exactly what was approved.
 */
import { randomBytes } from 'node:crypto';

import debug from 'debug';

import { PersonalAccountModel } from '@/database/models/personalAccount';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { expiringCache } from '@/server/services/messenger/expiringCache';

import {
  githubAppConfigured,
  githubRequest,
  githubWebBase,
  installationAccount,
  installationRepositories,
  installationToken,
  userInstallationIds,
} from './client';

const log = debug('lobe-server:github-app');

export class GithubConnectionError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_CONFIGURED' | 'NOT_CONNECTED',
    message: string,
  ) {
    super(message);
    this.name = 'GithubConnectionError';
  }
}

const STATE_TTL_SECONDS = 10 * 60;
const stateKey = (state: string) => `github:install:state:${state}`;

/** A push waits this long for the user's answer, as does the run asking for it. */
export const PUSH_REQUEST_TTL_SECONDS = 2 * 60 * 60;
const pushKey = (userId: string, toolCallId: string) => `coding:push:${userId}:${toolCallId}`;

/** The most a single push may carry. */
export const PUSH_LIMITS = { bytes: 5 * 1024 * 1024, files: 300 };

/** One file a push changes: its new content (base64) and mode, or its removal. */
export interface PushedFile {
  /** base64; absent for a removed file */
  content?: string;
  /** `100755` for an executable file */
  mode?: '100644' | '100755';
  path: string;
  status: 'added' | 'deleted' | 'modified';
}

export interface PushRequest {
  baseRef: string;
  baseSha: string;
  body: string;
  branch: string;
  files: PushedFile[];
  operationId: string;
  repository: string;
  title: string;
}

/** The user who a state was made for, once: a second use, or a late one, gets nothing. */
const takeState = async (state: string) => {
  if (!/^[\da-f]{48}$/.test(state)) return undefined;
  const userId = await expiringCache.get(stateKey(state));
  if (userId) await expiringCache.del(stateKey(state));
  return userId;
};

/** Whether a path in a push stays inside the repository and out of its git internals. */
const safePath = (path: string) =>
  !!path &&
  !path.startsWith('/') &&
  !path.split('/').some((part) => part === '..' || part === '' || part === '.git');

const slug = (title: string) =>
  title
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40) || 'changes';

/** How the phone's approval card shows a push: what changes where. */
export const pushSummary = (
  request: Pick<PushRequest, 'branch' | 'files' | 'repository' | 'title'>,
) => ({
  repository: request.repository,
  branch: request.branch,
  pullRequest: request.title,
  files: request.files
    .slice(0, 20)
    .map((file) => `${file.path} (${file.status})`)
    .join(', ')
    .concat(request.files.length > 20 ? `, and ${request.files.length - 20} more` : ''),
});

const accountsOf = async (db: LobeChatDatabase, userId: string) =>
  new PersonalAccountModel(db, userId, await KeyVaultsGateKeeper.initWithEnvKey());

export class GithubConnectionService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  /** The page where the user installs the App on the repositories they choose. */
  async connectUrl() {
    if (!githubAppConfigured()) {
      throw new GithubConnectionError('NOT_CONFIGURED', 'This deployment has no GitHub App');
    }
    const state = randomBytes(24).toString('hex');
    await expiringCache.set(stateKey(state), this.userId, STATE_TTL_SECONDS);
    const { githubAppEnv } = await import('@/envs/github');
    return `${githubWebBase()}/apps/${githubAppEnv.GITHUB_APP_SLUG}/installations/new?state=${state}`;
  }

  /**
   * Keeps the installation GitHub sent the user back with, for the user the `state` was made for,
   * once the OAuth code shows they may use it. Returns the account it was installed on.
   */
  static async completeConnection(
    db: LobeChatDatabase,
    { code, installationId, state }: { code: string; installationId: number; state: string },
  ) {
    const userId = await takeState(state);
    if (!userId) throw new GithubConnectionError('BAD_REQUEST', 'This link has expired');

    const allowed = await userInstallationIds(code);
    if (!allowed.includes(installationId)) {
      log('user %s sent installation %d they cannot use', userId, installationId);
      throw new GithubConnectionError('FORBIDDEN', 'That installation is not yours');
    }

    const account = await installationAccount(installationId);
    await (
      await accountsOf(db, userId)
    ).save({
      // Nothing secret is kept: the App's key stays in the server's settings
      credentials: '{}',
      kind: 'code',
      label: account.login,
      provider: 'github',
      settings: { accountType: account.type, installationId },
    });
    log('user %s connected GitHub %s (installation %d)', userId, account.login, installationId);
    return { login: account.login };
  }

  private async installationId() {
    const account = await (await accountsOf(this.db, this.userId)).find('code');
    const installationId = account?.settings?.installationId;
    if (typeof installationId !== 'number') {
      throw new GithubConnectionError('NOT_CONNECTED', 'GitHub is not connected');
    }
    return installationId;
  }

  /** The connected account and the repositories it gave Biber; `connected: false` without one. */
  async status() {
    const account = (await (await accountsOf(this.db, this.userId)).list()).find(
      (item) => item.kind === 'code',
    );
    if (!account) return { available: githubAppConfigured(), connected: false as const };
    const repositories = await installationRepositories(
      account.settings.installationId as number,
    ).catch((error) => {
      log('listing repositories for %s failed: %O', this.userId, error);
      return undefined;
    });
    return {
      available: true,
      connected: true as const,
      login: account.label,
      repositories: repositories?.map((repository) => repository.fullName),
    };
  }

  /** Forgets the installation here; the App stays installed on GitHub until the user removes it. */
  async disconnect() {
    return (await accountsOf(this.db, this.userId)).remove('code');
  }

  async repositories() {
    return installationRepositories(await this.installationId());
  }

  private async repository(fullName: string) {
    const repository = (await this.repositories()).find(
      (item) => item.fullName.toLowerCase() === fullName.toLowerCase(),
    );
    if (!repository) {
      throw new GithubConnectionError(
        'FORBIDDEN',
        `${fullName} is not one of the repositories the user gave Biber`,
      );
    }
    return repository;
  }

  /**
   * A snapshot of a repository for the coding computer: GitHub's own download link for it, which
   * works for a few minutes and only for that archive.
   */
  async openRepository(fullName: string, ref?: string) {
    const repository = await this.repository(fullName);
    const token = await installationToken(await this.installationId(), [
      repository.fullName.split('/')[1],
    ]);
    const baseRef = ref || repository.defaultBranch;
    const { data: commit } = await githubRequest<{ sha: string }>(
      `/repos/${repository.fullName}/commits/${encodeURIComponent(baseRef)}`,
      { token },
    );
    const { response } = await githubRequest(
      `/repos/${repository.fullName}/tarball/${commit.sha}`,
      { redirect: 'manual', token },
    );
    const tarballUrl = response.headers.get('location');
    if (!tarballUrl) throw new GithubConnectionError('BAD_REQUEST', 'GitHub gave no download');
    log('user %s opened %s at %s', this.userId, repository.fullName, commit.sha);
    return { baseRef, baseSha: commit.sha, repository: repository.fullName, tarballUrl };
  }

  /**
   * Keeps a run's push until the user answers, after checking it: a repository the user gave
   * Biber, paths inside it, within the size limits. Returns what the approval card shows.
   */
  async requestPush(
    toolCallId: string,
    request: Omit<PushRequest, 'branch'> & { branch?: string },
  ) {
    const repository = await this.repository(request.repository);
    if (request.files.length === 0) {
      throw new GithubConnectionError('BAD_REQUEST', 'There are no changes to push');
    }
    if (request.files.length > PUSH_LIMITS.files) {
      throw new GithubConnectionError(
        'BAD_REQUEST',
        `A push may change at most ${PUSH_LIMITS.files} files`,
      );
    }
    const bytes = request.files.reduce((sum, file) => sum + (file.content?.length ?? 0), 0);
    if (bytes > PUSH_LIMITS.bytes) {
      throw new GithubConnectionError('BAD_REQUEST', 'The changes are too large to push at once');
    }
    const unsafe = request.files.find((file) => !safePath(file.path));
    if (unsafe)
      throw new GithubConnectionError('BAD_REQUEST', `Not a path to push: ${unsafe.path}`);

    // Always a new branch of Biber's own; the name says what it is for
    const branch = `biber/${slug(request.branch || request.title)}-${randomBytes(3).toString('hex')}`;
    const pending: PushRequest = { ...request, branch, repository: repository.fullName };
    await expiringCache.set(
      pushKey(this.userId, toolCallId),
      JSON.stringify(pending),
      PUSH_REQUEST_TTL_SECONDS,
    );
    log('user %s: push of %d files to %s waits', this.userId, request.files.length, branch);
    return pushSummary(pending);
  }

  /** The push a run is waiting on, as it was asked for; undefined once answered or expired. */
  async pendingPush(toolCallId: string): Promise<PushRequest | undefined> {
    const raw = await expiringCache.get(pushKey(this.userId, toolCallId));
    return raw ? (JSON.parse(raw) as PushRequest) : undefined;
  }

  /**
   * Makes the approved push: one commit on the approved base, on the new branch, and a pull
   * request into the branch the snapshot came from. Exactly the files that were approved.
   */
  async push(toolCallId: string) {
    const request = await this.pendingPush(toolCallId);
    if (!request) throw new GithubConnectionError('BAD_REQUEST', 'This push has expired');
    await expiringCache.del(pushKey(this.userId, toolCallId));

    const [owner, name] = request.repository.split('/');
    const token = await installationToken(await this.installationId(), [name]);
    const path = `/repos/${owner}/${name}`;

    const { data: base } = await githubRequest<{ tree: { sha: string } }>(
      `${path}/git/commits/${request.baseSha}`,
      { token },
    );
    const tree = [];
    for (const file of request.files) {
      if (file.status === 'deleted') {
        tree.push({ mode: '100644', path: file.path, sha: null, type: 'blob' });
        continue;
      }
      const { data: blob } = await githubRequest<{ sha: string }>(`${path}/git/blobs`, {
        body: { content: file.content ?? '', encoding: 'base64' },
        method: 'POST',
        token,
      });
      tree.push({ mode: file.mode ?? '100644', path: file.path, sha: blob.sha, type: 'blob' });
    }
    const { data: newTree } = await githubRequest<{ sha: string }>(`${path}/git/trees`, {
      body: { base_tree: base.tree.sha, tree },
      method: 'POST',
      token,
    });
    const { data: commit } = await githubRequest<{ sha: string }>(`${path}/git/commits`, {
      body: {
        message: request.body ? `${request.title}\n\n${request.body}` : request.title,
        parents: [request.baseSha],
        tree: newTree.sha,
      },
      method: 'POST',
      token,
    });
    await githubRequest(`${path}/git/refs`, {
      body: { ref: `refs/heads/${request.branch}`, sha: commit.sha },
      method: 'POST',
      token,
    });
    const { data: pull } = await githubRequest<{ html_url: string; number: number }>(
      `${path}/pulls`,
      {
        body: {
          base: request.baseRef,
          body: request.body,
          head: request.branch,
          title: request.title,
        },
        method: 'POST',
        token,
      },
    );
    log('user %s pushed %s and opened #%d', this.userId, request.branch, pull.number);
    return { branch: request.branch, commit: commit.sha, pullRequestUrl: pull.html_url };
  }

  /** Drops a push the user declined. */
  async declinePush(toolCallId: string) {
    await expiringCache.del(pushKey(this.userId, toolCallId));
  }
}
