import { classifyTool } from '@lobechat/agent-policy';
import {
  type DynamicInterventionResolver,
  type GlobalInterventionAuditConfig,
  type ToolSource,
} from '@lobechat/types';

export const EXTERNAL_SENSITIVE_ACTION_AUDIT_TYPE = 'externalSensitiveAction';

interface AuditedToolCall {
  apiName: string;
  identifier: string;
  source?: ToolSource;
  type?: string;
}

/** Sources whose tools act on the user's third-party accounts. */
const EXTERNAL_SOURCES = new Set<ToolSource>(['composio', 'lobehubSkill', 'mcp']);

/**
 * Builtin tools ship their own curated intervention config. Third-party tools (MCP servers,
 * plugins, Composio and LobeHub Skills connectors) usually ship none, so without this audit a
 * `send_email` or `delete_repo` from them would run unasked.
 */
const isExternalTool = (call: AuditedToolCall) =>
  (call.source !== undefined && EXTERNAL_SOURCES.has(call.source)) ||
  (call.type !== undefined && call.type !== 'builtin');

/**
 * A third-party tool call that sends, pays, publishes, merges, deploys or deletes something waits
 * for the user, in every approval mode; headless runs get it back as a blocked result. A tool the
 * user chose to always allow (`identifier/apiName` in the allow list) runs as before.
 *
 * Reads `metadata.toolCall` and `metadata.allowList`, which the agent adds for global audits.
 */
export const createExternalSensitiveActionAudit = (): DynamicInterventionResolver => {
  return async (_toolArgs, metadata) => {
    const call = metadata?.toolCall as AuditedToolCall | undefined;
    if (!call || !isExternalTool(call)) return false;

    const allowList = (metadata?.allowList as string[] | undefined) ?? [];
    if (allowList.includes(`${call.identifier}/${call.apiName}`)) return false;

    return classifyTool({ name: call.apiName }) === 'sensitive';
  };
};

export const createExternalSensitiveActionGlobalAudit = (): GlobalInterventionAuditConfig => ({
  policy: 'always',
  resolver: createExternalSensitiveActionAudit(),
  type: EXTERNAL_SENSITIVE_ACTION_AUDIT_TYPE,
});
