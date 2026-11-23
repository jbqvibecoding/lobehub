import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCodingTools } from './codingTools';

const noWait = vi.fn();

const toolNamed = (tools: ReturnType<typeof buildCodingTools>, name: string) =>
  tools.find((tool) => tool.name === name)!;

describe('buildCodingTools', () => {
  it('deliver_file sends the run’s file to the server and answers with what it stored', async () => {
    const file = { fileId: 'file-1', filename: 'report.pdf', size: 12, url: '/f/file-1' };
    const mutate = vi.fn().mockResolvedValue(file);
    const tools = buildCodingTools({
      client: { aiAgent: { heteroDeliverFile: { mutate } } } as any,
      cwd: '/workspace/app',
      topicId: 'tpc-1',
      waitForUser: noWait,
    });

    const result = await toolNamed(tools, 'deliver_file').handler(
      'op-1',
      { path: 'out/report.pdf' },
      {},
    );

    expect(mutate).toHaveBeenCalledWith({
      operationId: 'op-1',
      path: '/workspace/app/out/report.pdf',
      topicId: 'tpc-1',
    });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(file);
  });

  it('lets a refusal reach Claude Code as the tool’s error', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('report.pdf is empty (0 bytes).'));
    const tools = buildCodingTools({
      client: { aiAgent: { heteroDeliverFile: { mutate } } } as any,
      cwd: '/workspace',
      topicId: 'tpc-1',
      waitForUser: noWait,
    });

    await expect(
      toolNamed(tools, 'deliver_file').handler('op-1', { path: '/workspace/report.pdf' }, {}),
    ).rejects.toThrow('empty');
  });
});

describe('a repository from the user’s GitHub', () => {
  let work: string;
  let archive: Buffer;

  beforeEach(async () => {
    work = await mkdtemp(path.join(os.tmpdir(), 'biber-coding-tools-'));
    // GitHub's tarball: everything under one top-level folder
    const source = path.join(work, 'source', 'acme-app-aaaaaaa');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'README.md'), '# App\n');
    await writeFile(path.join(source, 'old.txt'), 'remove me\n');
    execFileSync('tar', [
      '-czf',
      path.join(work, 'repo.tar.gz'),
      '-C',
      path.join(work, 'source'),
      'acme-app-aaaaaaa',
    ]);
    archive = await readFile(path.join(work, 'repo.tar.gz'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(archive)),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(work, { force: true, recursive: true });
  });

  const tools = (mutate: Record<string, ReturnType<typeof vi.fn>>, waitForUser = noWait) =>
    buildCodingTools({
      client: {
        aiAgent: {
          heteroOpenRepo: { mutate: mutate.open },
          heteroRequestPush: { mutate: mutate.push },
        },
      } as any,
      cwd: path.join(work, 'workspace'),
      topicId: 'tpc-1',
      waitForUser,
    });

  const opened = {
    baseRef: 'main',
    baseSha: 'a'.repeat(40),
    repository: 'acme/app',
    tarballUrl: 'https://codeload.github.test/acme/app?token=short',
  };

  it('opens it into its own git repository, without credentials, and pushes only what changed', async () => {
    const open = vi.fn().mockResolvedValue(opened);
    const push = vi.fn().mockResolvedValue({
      branch: 'biber/readme-abc123',
      files: 'README.md (modified)',
      pullRequest: 'Better README',
      repository: 'acme/app',
    });
    const waitForUser = vi.fn().mockResolvedValue({
      result: { pullRequestUrl: 'https://github.test/acme/app/pull/5' },
    });
    const [, , openRepo, pushChanges] = tools({ open, push }, waitForUser);

    const result = await openRepo.handler('op-1', { repository: 'acme/app' }, {} as any);
    expect((result.content[0] as { text: string }).text).toContain('Opened acme/app at main');
    const dir = path.join(work, 'workspace', 'app');
    expect(await readFile(path.join(dir, 'README.md'), 'utf8')).toBe('# App\n');
    expect(
      JSON.parse(await readFile(path.join(dir, '.git', 'biber-base.json'), 'utf8')),
    ).toMatchObject({ baseRef: 'main', baseSha: 'a'.repeat(40), repository: 'acme/app' });

    await writeFile(path.join(dir, 'README.md'), '# App\n\nBetter.\n');
    await writeFile(path.join(dir, 'run.sh'), '#!/bin/sh\n');
    await chmod(path.join(dir, 'run.sh'), 0o755);
    await rm(path.join(dir, 'old.txt'));
    expect((await stat(path.join(dir, 'run.sh'))).mode & 0o111).toBeTruthy();

    const pushed = await pushChanges.handler(
      'op-1',
      { directory: 'app', title: 'Better README' },
      { progressIntervalMs: 30_000, toolCallId: 'toolu_push' },
    );

    const request = push.mock.calls[0][0];
    expect(request).toMatchObject({
      baseRef: 'main',
      baseSha: 'a'.repeat(40),
      operationId: 'op-1',
      repository: 'acme/app',
      title: 'Better README',
      toolCallId: 'toolu_push',
      topicId: 'tpc-1',
    });
    expect(request.files).toEqual([
      {
        content: Buffer.from('# App\n\nBetter.\n').toString('base64'),
        mode: '100644',
        path: 'README.md',
        status: 'modified',
      },
      { path: 'old.txt', status: 'deleted' },
      {
        content: Buffer.from('#!/bin/sh\n').toString('base64'),
        mode: '100755',
        path: 'run.sh',
        status: 'added',
      },
    ]);
    // Waits on the run's bridge, under the call's own id
    expect(waitForUser).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'toolu_push' }),
      expect.objectContaining({ timeoutMs: 2 * 60 * 60 * 1000 }),
    );
    expect((pushed.content[0] as { text: string }).text).toContain(
      'Pull request: https://github.test/acme/app/pull/5',
    );
  });

  it('says so when the user declines, and refuses a directory open_repo did not make', async () => {
    const open = vi.fn().mockResolvedValue(opened);
    const push = vi.fn().mockResolvedValue({ branch: 'biber/x', repository: 'acme/app' });
    const waitForUser = vi.fn().mockResolvedValue({
      cancelReason: 'user_cancelled',
      cancelled: true,
      result: { reason: 'Not now' },
    });
    const [, , openRepo, pushChanges] = tools({ open, push }, waitForUser);
    await openRepo.handler('op-1', { repository: 'acme/app' }, {} as any);
    await writeFile(path.join(work, 'workspace', 'app', 'README.md'), 'changed\n');

    const declined = await pushChanges.handler(
      'op-1',
      { directory: 'app', title: 'Change' },
      { progressIntervalMs: 30_000, toolCallId: 'toolu_x' },
    );
    expect(declined).toMatchObject({ isError: true });
    expect((declined.content[0] as { text: string }).text).toContain('Not now');

    await mkdir(path.join(work, 'workspace', 'other'), { recursive: true });
    const elsewhere = await pushChanges.handler(
      'op-1',
      { directory: 'other', title: 'Change' },
      { progressIntervalMs: 30_000, toolCallId: 'toolu_y' },
    );
    expect(elsewhere).toMatchObject({ isError: true });
    expect(push).toHaveBeenCalledTimes(1);
  });
});
