import path from 'node:path';

import type { McpExtraTool } from '@lobechat/heterogeneous-agents/builtinMcp';
import { z } from 'zod';

import type { TrpcClient } from '../../api/client';

/**
 * Biber's tools for Claude Code on the coding computer, mounted on the `lobe_cc` MCP server next to
 * `ask_user_question`. Each one is a call to the server with the run's own token: the computer
 * holds no credentials, so whatever reaches outside it (files for the user, later the user's
 * GitHub) goes through the server.
 */
export const buildCodingTools = ({
  client,
  cwd,
  topicId,
}: {
  client: TrpcClient;
  /** Where Claude Code works; relative paths are taken from here */
  cwd: string;
  topicId: string;
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
      return { content: [{ text: JSON.stringify(file), type: 'text' }] };
    },
    inputSchema: {
      path: z.string().describe('The file, absolute or relative to your working directory'),
    },
    name: 'deliver_file',
    title: 'Deliver a file',
  },
];
