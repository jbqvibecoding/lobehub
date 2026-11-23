/**
 * GitHub's REST API as the Biber GitHub App: the App's own JWT, installation tokens narrowed to
 * one repository, and the user's OAuth answer when they install the App. Only the server holds
 * the App's key.
 */
import { createPrivateKey } from 'node:crypto';

import debug from 'debug';
import { importPKCS8, SignJWT } from 'jose';

import { githubAppEnv } from '@/envs/github';

const log = debug('lobe-server:github-app');

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export const githubApiBase = () =>
  (githubAppEnv.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
export const githubWebBase = () =>
  (githubAppEnv.GITHUB_WEB_URL ?? 'https://github.com').replace(/\/+$/, '');

/** Whether this deployment has a GitHub App; without one, repositories cannot be connected. */
export const githubAppConfigured = () =>
  !!(
    githubAppEnv.GITHUB_APP_ID &&
    githubAppEnv.GITHUB_APP_PRIVATE_KEY &&
    githubAppEnv.GITHUB_APP_SLUG &&
    githubAppEnv.GITHUB_APP_CLIENT_ID &&
    githubAppEnv.GITHUB_APP_CLIENT_SECRET
  );

/** The App's own token, good for ten minutes, for the `/app/...` endpoints. */
const appJwt = async () => {
  // GitHub hands out PKCS#1 keys; jose takes PKCS#8, so Node reads either and re-exports it
  const pem = createPrivateKey((githubAppEnv.GITHUB_APP_PRIVATE_KEY ?? '').replaceAll('\\n', '\n'))
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const key = await importPKCS8(pem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return (
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(githubAppEnv.GITHUB_APP_ID ?? '')
      // GitHub allows a minute of clock drift
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(key)
  );
};

export const githubRequest = async <T>(
  path: string,
  {
    body,
    method = 'GET',
    redirect,
    token,
  }: { body?: unknown; method?: string; redirect?: RequestRedirect; token: string },
): Promise<{ data: T; response: Response }> => {
  const response = await fetch(`${githubApiBase()}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Biber',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    method,
    redirect,
    signal: AbortSignal.timeout(30_000),
  });
  if (redirect === 'manual' && response.status >= 300 && response.status < 400) {
    return { data: undefined as T, response };
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((json: { message?: string }) => json?.message)
      .catch(() => undefined);
    log('%s %s answered %d: %s', method, path, response.status, detail);
    throw new GithubApiError(response.status, detail ?? `GitHub answered ${response.status}`);
  }
  const data = response.status === 204 ? undefined : await response.json();
  return { data: data as T, response };
};

/**
 * A token for one installation, narrowed to the given repositories and to reading and writing
 * contents and pull requests. It lasts an hour and never leaves the server.
 */
export const installationToken = async (installationId: number, repositories?: string[]) => {
  const { data } = await githubRequest<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    {
      body: {
        permissions: { contents: 'write', metadata: 'read', pull_requests: 'write' },
        ...(repositories && { repositories }),
      },
      method: 'POST',
      token: await appJwt(),
    },
  );
  return data.token;
};

/** Who an installation belongs to: the user or organization account it was installed on. */
export const installationAccount = async (installationId: number) => {
  const { data } = await githubRequest<{ account?: { login?: string; type?: string } }>(
    `/app/installations/${installationId}`,
    { token: await appJwt() },
  );
  return { login: data.account?.login ?? '', type: data.account?.type ?? 'User' };
};

/**
 * The installations of this App that the user who just authorized it may use, from the code
 * GitHub sent back. This is what ties an installation to the Biber user: an installation id in
 * the callback alone proves nothing, anyone can type one.
 */
export const userInstallationIds = async (code: string) => {
  const tokenResponse = await fetch(`${githubWebBase()}/login/oauth/access_token`, {
    body: JSON.stringify({
      client_id: githubAppEnv.GITHUB_APP_CLIENT_ID,
      client_secret: githubAppEnv.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  });
  const { access_token: userToken } = (await tokenResponse.json()) as { access_token?: string };
  if (!userToken) throw new GithubApiError(401, 'GitHub did not authorize the user');

  const { data } = await githubRequest<{ installations?: { id: number }[] }>(
    '/user/installations?per_page=100',
    { token: userToken },
  );
  return (data.installations ?? []).map((installation) => installation.id);
};

export interface GithubRepository {
  defaultBranch: string;
  fullName: string;
  private: boolean;
}

/** The repositories the user gave the App, up to the first 300. */
export const installationRepositories = async (
  installationId: number,
): Promise<GithubRepository[]> => {
  const token = await installationToken(installationId);
  const repositories: GithubRepository[] = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await githubRequest<{
      repositories: { default_branch: string; full_name: string; private: boolean }[];
    }>(`/installation/repositories?per_page=100&page=${page}`, { token });
    repositories.push(
      ...data.repositories.map((repository) => ({
        defaultBranch: repository.default_branch,
        fullName: repository.full_name,
        private: repository.private,
      })),
    );
    if (data.repositories.length < 100) break;
  }
  return repositories;
};
