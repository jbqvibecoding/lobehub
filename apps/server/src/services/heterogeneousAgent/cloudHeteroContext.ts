export interface ConversationHistoryEntry {
  content: string;
  role: 'assistant' | 'user';
}

/**
 * Builds the system context injected before every user prompt for cloud Claude Code runs.
 *
 * This context is cloud-sandbox-specific: it describes the workspace layout,
 * says that no credentials are in the sandbox, lists the GitHub repos that were
 * pre-cloned, and tells CC how to handle repos that could not be cloned.
 *
 * It is NOT the agent's systemRole (which lives in agentConfig.systemRole and
 * is a user-facing persona definition). This is pure infra context for CC.
 *
 * Returned string is passed as the first text block in the --input-json array
 * via sandboxRunner → spawnHeteroSandbox. If nothing meaningful to inject,
 * returns undefined so no extra block is added.
 */
export function buildCloudHeteroContext(params: {
  repos: string[];
  /** Static systemContext from HeterogeneousProviderConfig.systemContext (agent-level). */
  agentSystemContext?: string;
  /**
   * Recent conversation turns to inject when resuming a session whose context
   * was cleared (sandbox recycled or context overflow).  Helps CC understand
   * what happened in prior turns even without a native session file.
   */
  conversationHistory?: ConversationHistoryEntry[];
  /**
   * Whether `/workspace` outlives the run: true on the user's own cloud computer (`openbot`),
   * false on a sandbox that is recycled after about an hour.
   */
  persistentWorkspace?: boolean;
}): string {
  const { repos, agentSystemContext, conversationHistory, persistentWorkspace } = params;

  const parts: string[] = [];

  // --- Agent-level static context (highest priority, goes first) ---
  if (agentSystemContext?.trim()) {
    parts.push(agentSystemContext.trim());
  }

  // --- Cloud workspace context ---
  // No credential of any kind is put in the sandbox (the run token reports this run and nothing
  // else), so the agent is told plainly not to try pushing or authenticating.
  const workspaceLines: string[] = [
    '## Cloud Workspace',
    'You are running inside a cloud sandbox. Your working directory is `/workspace`.',
    persistentWorkspace
      ? "This is the user's own cloud computer: files in `/workspace` are kept between conversations, but it is not a backup."
      : 'This sandbox is ephemeral: it is destroyed after about an hour of inactivity, and files in `/workspace` go with it.',
    '',
    '## No Credentials',
    'This sandbox holds no GitHub token or other account credentials, and none will be given to you.',
    '- Do not run `git push`, `gh auth`, or anything else that needs to sign in, and do not ask the user for a token or password.',
    '- Commit your work locally in its repository. To hand changes or files to the user, use the tools your instructions name; without such a tool, say in your reply exactly what you changed and where it is.',
  ];

  if (repos.length > 0) {
    workspaceLines.push(
      '',
      '## GitHub Repositories',
      'The following repositories were pre-cloned into `/workspace` before this conversation started:',
      ...repos.map((repo) => {
        const dir = repoToLocalDir(repo);
        const url = toGithubUrl(repo);
        return `- \`/workspace/${dir}\`  (${url})`;
      }),
      '',
      'You can start working in any of these directories immediately.',
      'A missing directory means the clone failed, most likely because the repository is private; say so rather than trying to sign in.',
    );
  } else {
    workspaceLines.push('', 'No GitHub repositories have been pre-cloned for this conversation.');
  }

  parts.push(workspaceLines.join('\n'));

  // --- Previous conversation context (injected when session was reset) ---
  // Truncate per-message to avoid ballooning the system context:
  //   user turns    → 1 KB (prompts are usually short)
  //   assistant turns → 2 KB (responses may be longer but we want the gist)
  if (conversationHistory && conversationHistory.length > 0) {
    const USER_MAX = 1024;
    const ASST_MAX = 2048;
    const entries = conversationHistory.map((entry) => {
      const limit = entry.role === 'user' ? USER_MAX : ASST_MAX;
      const body =
        entry.content.length > limit
          ? `${entry.content.slice(0, limit)}… [truncated]`
          : entry.content;
      return `<${entry.role}>\n${body}\n</${entry.role}>`;
    });
    parts.push(`<previous_conversation>\n${entries.join('\n')}\n</previous_conversation>`);
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers (mirrors sandboxRunner logic — kept local to avoid coupling)
// ---------------------------------------------------------------------------

function repoToLocalDir(repo: string): string {
  return (repo.split('/').findLast(Boolean) ?? repo).replace(/\.git$/, '');
}

function toGithubUrl(repo: string): string {
  if (repo.startsWith('http')) return repo.replace(/\.git$/, '');
  return `https://github.com/${repo}`;
}
