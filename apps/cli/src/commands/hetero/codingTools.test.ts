import { describe, expect, it, vi } from 'vitest';

import { buildCodingTools } from './codingTools';

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
    });

    await expect(
      toolNamed(tools, 'deliver_file').handler('op-1', { path: '/workspace/report.pdf' }, {}),
    ).rejects.toThrow('empty');
  });
});
