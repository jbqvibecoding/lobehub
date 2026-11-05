/**
 * How a tool is classified and which tools a grant exposes, copied from Tucano
 * (`src/core/policy.ts`, Apache-2.0).
 */
import type { GrantLevel, PolicyTool, ToolClass } from './types';

const READ_WORDS = new Set([
  'count',
  'describe',
  'fetch',
  'find',
  'get',
  'list',
  'lookup',
  'query',
  'read',
  'retrieve',
  'search',
  'show',
  'view',
]);

const SENSITIVE_WORDS = new Set([
  'delete',
  'deploy',
  'destroy',
  'drop',
  'merge',
  'pay',
  'publish',
  'remove',
  'revoke',
  'send',
  'transfer',
]);

/** `mergePullRequest` and `merge_pull_request` both become `merge pull request`. */
const words = (name: string): string[] =>
  name
    .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^\da-z]+/)
    .filter(Boolean);

/**
 * Annotations first, then the name. A sensitive word anywhere wins over a read verb at the start,
 * since a wrong "read" would skip approval.
 */
export const classifyTool = (tool: Pick<PolicyTool, 'annotations' | 'name'>): ToolClass => {
  if (tool.annotations?.readOnlyHint === true) return 'read';
  if (tool.annotations?.destructiveHint === true) return 'sensitive';

  const parts = words(tool.name);
  if (parts.some((part) => SENSITIVE_WORDS.has(part))) return 'sensitive';
  if (parts[0] && READ_WORDS.has(parts[0])) return 'read';

  return 'write';
};

/** `read` exposes read tools; `read_write` exposes everything (sensitive ones still ask). */
export const isToolExposed = (toolClass: ToolClass, grant: GrantLevel | undefined): boolean => {
  if (grant === 'read') return toolClass === 'read';
  return grant === 'read_write';
};
