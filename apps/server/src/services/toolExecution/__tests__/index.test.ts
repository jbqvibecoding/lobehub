// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import type * as ConnectorPermissionCheck from '@/libs/mcp/connectorPermissionCheck';
import type * as AgentActionAudit from '@/server/services/agentActionAudit';

import { ToolExecutionService } from '../index';

const { mockGetConnectorToolPermission, mockRecordAgentAction } = vi.hoisted(() => ({
  mockGetConnectorToolPermission: vi.fn(),
  mockRecordAgentAction: vi.fn(),
}));

vi.mock('@/libs/mcp/connectorPermissionCheck', async (importOriginal) => ({
  ...(await importOriginal<typeof ConnectorPermissionCheck>()),
  getConnectorToolPermission: mockGetConnectorToolPermission,
}));

vi.mock('@/server/services/agentActionAudit', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentActionAudit>()),
  recordAgentAction: mockRecordAgentAction,
}));

describe('ToolExecutionService', () => {
  it('can skip low-level result truncation for AgentRuntime archival', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        skipResultTruncation: true,
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toBe('0123456789');
  });

  it('keeps existing low-level truncation by default', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
  });

  describe('agent action trail', () => {
    const serverDB = {} as any;
    const context = {
      agentId: 'agent-1',
      operationId: 'op-1',
      serverDB,
      toolCallId: 'call-1',
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const run = (apiName: string, execute: () => Promise<unknown>) =>
      new ToolExecutionService({
        builtinToolsExecutor: { execute: vi.fn(execute) } as any,
        mcpService: {} as any,
      }).executeTool(
        {
          apiName,
          arguments: '{"path":"notes.md"}',
          id: 'call-1',
          identifier: 'lobe-local-system',
          type: 'builtin',
        },
        context,
      );

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetConnectorToolPermission.mockResolvedValue(undefined);
    });

    it('records each run that can change something, with its outcome', async () => {
      await run('writeLocalFile', async () => ({ content: 'ok', success: true }));
      await run('removeLocalFile', async () => {
        throw new Error('EACCES');
      });

      expect(mockRecordAgentAction.mock.calls.map((call) => call[1])).toEqual([
        'succeeded',
        'failed',
      ]);
      expect(mockRecordAgentAction).toHaveBeenNthCalledWith(
        1,
        serverDB,
        'succeeded',
        expect.objectContaining({ apiName: 'writeLocalFile', id: 'call-1' }),
        { agentId: 'agent-1', operationId: 'op-1', topicId: 'topic-1', userId: 'user-1' },
        { executionTimeMs: expect.any(Number) },
      );
    });

    it('leaves reads out of the trail', async () => {
      await run('readLocalFile', async () => ({ content: 'hello', success: true }));

      expect(mockRecordAgentAction).not.toHaveBeenCalled();
    });

    it('records a call the user disabled as blocked, without running it', async () => {
      mockGetConnectorToolPermission.mockResolvedValue(ConnectorToolPermission.disabled);
      const execute = vi.fn();

      await run('listLocalFiles', execute);

      expect(execute).not.toHaveBeenCalled();
      expect(mockRecordAgentAction).toHaveBeenCalledWith(
        serverDB,
        'blocked',
        expect.anything(),
        expect.anything(),
        { errorCode: 'disabled_by_user' },
      );
    });
  });
});
