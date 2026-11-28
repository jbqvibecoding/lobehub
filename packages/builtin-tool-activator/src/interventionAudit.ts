import type { DynamicInterventionResolver } from '@lobechat/types';

export const ACTIVATE_TOOLS_AUDIT = 'activateToolsAudit';

const TOOL_NAME_SEPARATOR = '____';

const pluginIdOf = (identifier: string) => identifier.split(TOOL_NAME_SEPARATOR)[0];

// An identifier that names no tool may still open a skill by name, so only a
// request made entirely of tools the run already offers skips the approval.
// Biber: so do the agent's own plugins (`agentPluginIds`), which upstream may
// defer to this step; the agent was given them, activating one grants nothing.
export const activateToolsAudit: DynamicInterventionResolver = async (toolArgs, metadata) => {
  const identifiers: unknown = toolArgs?.identifiers;
  if (!Array.isArray(identifiers) || identifiers.length === 0) return true;

  const enabled = new Set<string>([
    ...(metadata?.enabledToolIds ?? []),
    ...(metadata?.agentPluginIds ?? []),
  ]);
  return !identifiers.every(
    (identifier) =>
      typeof identifier === 'string' &&
      (enabled.has(identifier) || enabled.has(pluginIdOf(identifier))),
  );
};
