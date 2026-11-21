import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:personal-accounts');

/**
 * Turns a tool on or off for Biber when the user connects or disconnects the account behind it
 * (their mailbox, their calendar, a Composio toolkit). It is saved on Biber's own agent, so Biber
 * has the tool in every chat, on the web too, and only while there is an account to use.
 */
export const setBiberTool = async (
  db: LobeChatDatabase,
  userId: string,
  identifier: string,
  enabled: boolean,
) => {
  const agents = new AgentModel(db, userId);
  const biber = await agents.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
  if (!biber) return;

  const plugins = biber.plugins ?? [];
  const has = plugins.includes(identifier);
  if (has === enabled) return;

  await agents.update(biber.id, {
    plugins: enabled ? [...plugins, identifier] : plugins.filter((id) => id !== identifier),
  });
  log('userId=%s %s %s for Biber', userId, enabled ? 'enabled' : 'disabled', identifier);
};
