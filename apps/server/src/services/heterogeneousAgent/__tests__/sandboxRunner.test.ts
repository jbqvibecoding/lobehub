import { lobeHubCliGuideBlock } from '@lobechat/heterogeneous-agents/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSandboxService } from '@/server/services/sandbox';

import { spawnHeteroSandbox } from '../sandboxRunner';

/** The prompt rides into the sandbox base64-encoded — decode it back out. */
const decodeStdinPayload = (command: string): string => {
  const encoded = command.match(/^echo '([^']+)' \| base64 -d/)?.[1];
  if (!encoded) throw new Error(`No base64 stdin payload in command: ${command}`);
  return Buffer.from(encoded, 'base64').toString('utf8');
};

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

const { mockCreateSandboxService } = vi.hoisted(() => ({
  mockCreateSandboxService: vi.fn(() => ({ callTool: mockCallTool })),
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mockCreateSandboxService,
}));

describe('spawnHeteroSandbox', () => {
  beforeEach(() => {
    mockCallTool.mockClear();
    mockCreateSandboxService.mockClear();
    mockCallTool.mockResolvedValue({ success: true });
  });

  it('pins an ephemeral run to /workspace and asks for no persistence', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockCallTool.mock.calls[0][1].command).toContain("'--cwd' '/workspace'");
    expect(mockCreateSandboxService).toHaveBeenCalledWith({
      marketService: {},
      purpose: 'coding',
      sandboxCwd: undefined,
      sandboxInstanceId: undefined,
      sandboxMode: undefined,
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(mockCallTool.mock.calls[0][1].command).not.toContain('CLAUDE_CODE_ENTRYPOINT');
  });

  it('runs a persistent topic in its instance and leaves the cwd to the execution plane', async () => {
    // Regression: a topic bound to an environment instance used to run in the
    // throwaway box at /workspace, because the runner never forwarded the
    // topic's persistence and hard-coded the directory.
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      sandbox: { cwd: 'lobehub-main', environment: 'inst-1', mode: 'persistent' },
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockCallTool.mock.calls[0][1].command).not.toContain('--cwd');
    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxCwd: 'lobehub-main',
        sandboxInstanceId: 'inst-1',
        sandboxMode: 'persistent',
      }),
    );
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

  it('runs in /workspace, or where a locally run computer keeps its workspace', async () => {
    const run = () =>
      spawnHeteroSandbox({
        agentType: 'claude-code',
        assistantMessageId: 'msg-1',
        jwt: 'jwt',
        marketService: {} as any,
        operationId: 'op-1',
        prompt: 'hi',
        topicId: 'topic-1',
        userId: 'user-1',
      });

    await run();
    expect(mockCallTool.mock.calls[0][1].command).toContain("'--cwd' '/workspace'");

    vi.stubEnv('LOBEHUB_HETERO_SANDBOX_CWD', '/tmp/computer/workspace');
    try {
      await run();
      expect(mockCallTool.mock.calls[1][1].command).toContain("'--cwd' '/tmp/computer/workspace'");
    } finally {
      vi.unstubAllEnvs();
    }
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
    // On the coding computer, apart from Biber's own
    expect(createSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'coding', topicId: 'topic-1', userId: 'user-1' }),
    );
    expect(command).toContain("LOBEHUB_JWT='run-token'");
    // Public clone, no credential of any kind
    expect(command).toContain("git clone -q 'https://github.com/owner/repo' 'repo'");
    expect(command).not.toMatch(/GITHUB_TOKEN|oauth2|gh auth|\.creds/);
    expect(started).toEqual({ commandId: 'bg-abc' });
  });

  it('points Claude Code at the coding gateway with the run token, and Codex at nothing', async () => {
    const base = {
      assistantMessageId: 'msg-1',
      jwt: 'run-token',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await spawnHeteroSandbox({ ...base, agentType: 'claude-code' });
    await spawnHeteroSandbox({ ...base, agentType: 'codex' });

    const claude = mockCallTool.mock.calls[0][1].command;
    expect(claude).toContain("ANTHROPIC_BASE_URL='https://app.example.com/api/coding/anthropic'");
    expect(claude).toContain("ANTHROPIC_API_KEY='run-token'");
    expect(claude).toContain('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1');
    expect(mockCallTool.mock.calls[1][1].command).not.toContain('ANTHROPIC_');
  });

  it('introduces the LobeHub CLI to a run that starts a new session', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const payload = JSON.parse(decodeStdinPayload(mockCallTool.mock.calls[0][1].command));
    expect(payload).toEqual([lobeHubCliGuideBlock, { text: 'hi', type: 'text' }]);
  });

  it('does not repeat the CLI introduction on a resumed session', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      resumeSessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(JSON.parse(decodeStdinPayload(mockCallTool.mock.calls[0][1].command))).toBe('hi');
  });

  it('injects LOBEHUB_WORKSPACE_ID when the topic belongs to a workspace', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-lobehub',
    });

    const command = mockCallTool.mock.calls[0][1].command;
    expect(command).toContain("LOBEHUB_WORKSPACE_ID='ws-lobehub'");
  });

  it('runs Claude Code under the entrypoint the agent asked for', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      claudeCodeEntrypoint: 'lobehub',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const command = mockCallTool.mock.calls[0][1].command;
    expect(command).toContain("CLAUDE_CODE_ENTRYPOINT='lobehub'");
    expect(command).toContain("CLAUDE_CODE_DISABLE_TERMINAL_TITLE='1'");
  });

  it('clears the entrypoint when the agent turned the setting off', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      claudeCodeEntrypoint: '',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockCallTool.mock.calls[0][1].command).toContain("CLAUDE_CODE_ENTRYPOINT=''");
  });
});
