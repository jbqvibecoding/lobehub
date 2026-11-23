/**
 * A real cloud computer for smoke runs: this repository's agent-computer, serving one computer,
 * headless, with its token derived the way the server derives it.
 */
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { waitFor } from './client';

/** The id the server gives a user's computer (`OPENBOT_COMPUTER_SCOPE=user`). */
export const computerIdForUser = (userId: string) =>
  `u-${createHash('sha256').update(userId).digest('hex').slice(0, 40)}`;

/** The id of a user's coding computer, where Claude Code runs (`OPENBOT_COMPUTER_SCOPE=user`). */
export const codingComputerIdForUser = (userId: string) =>
  `c-${createHash('sha256').update(userId).digest('hex').slice(0, 40)}`;

export const startLocalComputer = async ({
  computerId,
  env = {},
  port,
  secret,
  workspace: fixedWorkspace,
}: {
  computerId: string;
  /** More environment for the computer process, e.g. NODE_PATH */
  env?: Record<string, string>;
  port: number;
  /** The server's OPENBOT_COMPUTER_TOKEN */
  secret: string;
  /** Where its commands run, when the server must know it beforehand; a new folder otherwise */
  workspace?: string;
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'biber-computer-'));
  const workspace = fixedWorkspace ?? path.join(dir, 'workspace');
  const child = spawn('bun', ['src/index.ts'], {
    cwd: path.resolve('apps/computer/agent-computer'),
    env: {
      ...process.env,
      ...env,
      COMPUTER_BOT_ID: computerId,
      COMPUTER_BROWSER_MODE: 'headless',
      COMPUTER_TOKEN: createHmac('sha256', secret).update(`computer:${computerId}`).digest('hex'),
      PORT: String(port),
      PROFILES_DIR: path.join(dir, 'profiles'),
      WORKSPACE_DIR: workspace,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  await waitFor(
    'the cloud computer to start',
    async () => {
      if (child.exitCode !== null) throw new Error(`it exited:\n${output.slice(-2000)}`);
      const health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
      return health?.ok ? true : undefined;
    },
    60_000,
  );
  return {
    dir,
    output: () => output,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((done) => setTimeout(done, 1000));
      if (child.exitCode === null) child.kill('SIGKILL');
      await rm(dir, { force: true, recursive: true });
    },
    workspace,
  };
};
