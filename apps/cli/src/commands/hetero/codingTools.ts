import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  InterventionAnswer,
  PendingArgs,
  PendingOptions,
} from '@lobechat/heterogeneous-agents/askUser';
import type { McpExtraTool, McpToolResult } from '@lobechat/heterogeneous-agents/builtinMcp';
import { z } from 'zod';

import type { TrpcClient } from '../../api/client';

const run = promisify(execFile);

/** Where `open_repo` records what a directory was opened from, inside its own git folder. */
const BASE_FILE = path.join('.git', 'biber-base.json');

/** A push waits this long for the user's answer on the phone (the server keeps it as long). */
const PUSH_WAIT_MS = 2 * 60 * 60 * 1000;

interface RepoBase {
  baseRef: string;
  baseSha: string;
  /** The local commit `open_repo` made of the snapshot; changes are counted from it */
  localBase: string;
  repository: string;
}

const text = (value: string, isError = false): McpToolResult => ({
  content: [{ text: value, type: 'text' }],
  ...(isError && { isError: true }),
});

const git = (cwd: string, args: string[]) =>
  run(
    'git',
    ['-c', 'user.name=Biber', '-c', 'user.email=biber@users.noreply.github.com', ...args],
    {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

/** The directory `open_repo` made, from it or from any folder inside it. */
const findRepo = async (start: string) => {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const raw = await readFile(path.join(dir, BASE_FILE), 'utf8').catch(() => undefined);
    if (raw) return { base: JSON.parse(raw) as RepoBase, dir };
    if (path.dirname(dir) === dir) return undefined;
  }
};

/** What changed since `open_repo`, with the new contents, as the server's push takes it. */
export const changedFiles = async (dir: string, localBase: string) => {
  await git(dir, ['add', '-A']);
  const { stdout } = await git(dir, [
    'diff',
    '--cached',
    '--name-status',
    '--no-renames',
    '-z',
    localBase,
  ]);
  const parts = stdout.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const [letter, file] = [parts[index], parts[index + 1]];
    if (letter === 'D') {
      files.push({ path: file, status: 'deleted' as const });
      continue;
    }
    const absolute = path.join(dir, file);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink())
      throw new Error(`${file} is a symbolic link, which a push cannot carry`);
    files.push({
      content: (await readFile(absolute)).toString('base64'),
      mode: stat.mode & 0o111 ? ('100755' as const) : ('100644' as const),
      path: file,
      status: letter === 'A' ? ('added' as const) : ('modified' as const),
    });
  }
  return files;
};

/**
 * Biber's tools for Claude Code on the coding computer, mounted on the `lobe_cc` MCP server next to
 * `ask_user_question`. Each one is a call to the server with the run's own token: the computer
 * holds no credentials, so whatever reaches outside it (files for the user, the user's GitHub)
 * goes through the server, and a push waits for the user's approval on the phone.
 */
export const buildCodingTools = ({
  client,
  cwd,
  topicId,
  waitForUser,
}: {
  client: TrpcClient;
  /** Where Claude Code works; relative paths are taken from here */
  cwd: string;
  topicId: string;
  /** Holds a call until the user answers on the phone (the run's ask-user bridge) */
  waitForUser: (args: PendingArgs, options: PendingOptions) => Promise<InterventionAnswer>;
}): McpExtraTool[] => [
  {
    description:
      'Hand a file you made to the user: it appears in their chat as a file they can open or download. ' +
      'The file must exist and not be empty; a .docx, .pptx, .xlsx or .pdf must be a valid one. ' +
      'Use it for every file the user should get, then name the file in your reply.',
    handler: async (operationId, args) => {
      const file = await client.aiAgent.heteroDeliverFile.mutate({
        operationId,
        path: path.resolve(cwd, String(args.path ?? '')),
        topicId,
      });
      // JSON, so the adapter can turn it into the chat's file card
      return text(JSON.stringify(file));
    },
    inputSchema: {
      path: z.string().describe('The file, absolute or relative to your working directory'),
    },
    name: 'deliver_file',
    title: 'Deliver a file',
  },
  {
    description:
      "List the user's GitHub repositories you may open (the ones they gave Biber), with each default branch.",
    handler: async (operationId) => {
      const { repositories } = await client.aiAgent.heteroListRepos.query({ operationId, topicId });
      if (repositories.length === 0) return text('The user has given Biber no repositories.');
      return text(
        repositories
          .map(
            (repo) =>
              `${repo.fullName} (default branch ${repo.defaultBranch}${repo.private ? ', private' : ''})`,
          )
          .join('\n'),
      );
    },
    inputSchema: {},
    name: 'list_repos',
    title: 'List repositories',
  },
  {
    description:
      "Get one of the user's GitHub repositories (see list_repos) into a new directory, as a local git repository " +
      'at the branch or commit you name (the default branch otherwise). Work there, commit as you like, then hand ' +
      'the changes over with push_changes. You have no credentials: never git push, clone or pull from GitHub yourself.',
    handler: async (operationId, args) => {
      const repository = String(args.repository ?? '');
      const dir = path.resolve(cwd, String(args.directory || repository.split('/')[1] || 'repo'));
      if ((await readdir(dir).catch(() => [])).length > 0) {
        return text(`${dir} already exists and is not empty; name another directory.`, true);
      }

      const opened = await client.aiAgent.heteroOpenRepo.mutate({
        operationId,
        ref: args.ref ? String(args.ref) : undefined,
        repository,
        topicId,
      });

      const archive = path.join(os.tmpdir(), `biber-repo-${Date.now()}.tar.gz`);
      try {
        const download = await fetch(opened.tarballUrl);
        if (!download.ok) throw new Error(`The download failed (${download.status})`);
        await writeFile(archive, Buffer.from(await download.arrayBuffer()));
        await mkdir(dir, { recursive: true });
        await run('tar', ['-xzf', archive, '--strip-components=1', '-C', dir]);
      } finally {
        await rm(archive, { force: true });
      }

      await git(dir, ['init', '-q']);
      await git(dir, ['add', '-A']);
      await git(dir, [
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        `${opened.repository}@${opened.baseSha}`,
      ]);
      const { stdout: localBase } = await git(dir, ['rev-parse', 'HEAD']);
      const base: RepoBase = {
        baseRef: opened.baseRef,
        baseSha: opened.baseSha,
        localBase: localBase.trim(),
        repository: opened.repository,
      };
      await writeFile(path.join(dir, BASE_FILE), JSON.stringify(base));

      return text(
        `Opened ${opened.repository} at ${opened.baseRef} (${opened.baseSha.slice(0, 7)}) in ${dir}. ` +
          'Work there; push_changes hands your changes to the user for approval.',
      );
    },
    inputSchema: {
      directory: z
        .string()
        .optional()
        .describe(
          'Where to put it, relative to your working directory; the repository name by default',
        ),
      ref: z
        .string()
        .optional()
        .describe('A branch, tag or commit; the default branch when omitted'),
      repository: z.string().describe('owner/name, as list_repos shows it'),
    },
    name: 'open_repo',
    title: 'Open a repository',
  },
  {
    description:
      'Propose your changes to a repository you opened with open_repo: the user sees the repository, a new branch, ' +
      'your title and the changed files on their phone and approves or declines. On approval the server commits ' +
      'everything you changed since open_repo onto a new biber/... branch and opens a pull request; it never touches ' +
      'the default branch. This call waits for the answer.',
    handler: async (operationId, args, call) => {
      if (!call.toolCallId) return text('This call has no id to wait on; try again.', true);
      const found = await findRepo(path.resolve(cwd, String(args.directory ?? '.')));
      if (!found) return text('That directory was not opened with open_repo.', true);

      const files = await changedFiles(found.dir, found.base.localBase);
      if (files.length === 0)
        return text('Nothing changed since open_repo; there is nothing to push.', true);

      const summary = await client.aiAgent.heteroRequestPush.mutate({
        baseRef: found.base.baseRef,
        baseSha: found.base.baseSha,
        body: String(args.body ?? ''),
        files,
        operationId,
        repository: found.base.repository,
        title: String(args.title ?? ''),
        toolCallId: call.toolCallId,
        topicId,
      });

      const answer = await waitForUser(
        { arguments: summary, toolCallId: call.toolCallId },
        {
          onProgress: call.onProgress,
          progressIntervalMs: call.progressIntervalMs,
          timeoutMs: PUSH_WAIT_MS,
        },
      );
      const result = (answer.result ?? {}) as { pullRequestUrl?: string; reason?: string };
      if (answer.cancelled) {
        if (answer.cancelReason === 'timeout') {
          return text(
            'The user did not answer; nothing was pushed. Tell them the change is ready.',
            true,
          );
        }
        return text(
          `Nothing was pushed: ${result.reason ?? 'the user declined'}. Ask the user what to change.`,
          true,
        );
      }
      return text(
        `Approved and pushed to ${summary.branch} in ${summary.repository}. Pull request: ${result.pullRequestUrl}`,
      );
    },
    inputSchema: {
      body: z
        .string()
        .optional()
        .describe('The pull request description: what changed and why, how you checked it'),
      directory: z
        .string()
        .optional()
        .describe(
          'The directory open_repo made, or a folder inside it; your working directory by default',
        ),
      title: z.string().describe('The pull request title, a short summary of the change'),
    },
    name: 'push_changes',
    title: 'Push changes',
  },
];
