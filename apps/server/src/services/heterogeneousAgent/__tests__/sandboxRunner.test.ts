import { beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroSandbox } from '../sandboxRunner';

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: vi.fn(() => ({
    callTool: mockCallTool,
  })),
}));

describe('spawnHeteroSandbox', () => {
  beforeEach(() => {
    mockCallTool.mockClear();
    mockCallTool.mockResolvedValue({ success: true });
  });

  it('forwards resolved selector args to lh hetero exec', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      args: ['--model', 'opus', '--effort', 'high'],
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockCallTool).toHaveBeenCalledWith(
      'runCommand',
      expect.objectContaining({
        command: expect.stringContaining("'--model' 'opus' '--effort' 'high'"),
      }),
    );
  });

  it('shell-escapes selector args before interpolating the sandbox command', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      args: ['--model', '$(touch /tmp/pwned)', '--effort', "hi'there"],
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const command = mockCallTool.mock.calls[0][1].command;
    expect(command).toContain("'$(touch /tmp/pwned)'");
    expect(command).toContain("'hi'\\''there'");
    expect(command).not.toContain('"$(touch /tmp/pwned)"');
  });

  it('puts only the run token in the sandbox, and hands back the command to stop', async () => {
    mockCallTool.mockResolvedValue({ result: { commandId: 'bg-abc' }, success: true });

    const started = await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'run-token',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      repos: ['owner/repo'],
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const { background, command } = mockCallTool.mock.calls[0][1];
    expect(background).toBe(true);
    expect(command).toContain("LOBEHUB_JWT='run-token'");
    // Public clone, no credential of any kind
    expect(command).toContain("git clone -q 'https://github.com/owner/repo' 'repo'");
    expect(command).not.toMatch(/GITHUB_TOKEN|oauth2|gh auth|\.creds/);
    expect(started).toEqual({ commandId: 'bg-abc' });
  });
});
