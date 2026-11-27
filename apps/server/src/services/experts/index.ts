import debug from 'debug';
import { and, eq, inArray } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getSandboxProviderKind } from '@/server/services/sandbox/deployment';

import {
  EXPERT_CHAT_CONFIG,
  EXPERT_PLUGINS,
  expertMarketIdentifier,
  EXPERTS,
  type ExpertTemplate,
  findExpert,
  localized,
} from './catalog';

const log = debug('lobe-server:experts');

/** Whether this deployment can run the expert: the coding expert needs the coding computer. */
const offered = (expert: ExpertTemplate) =>
  !expert.requiresCodingComputer || getSandboxProviderKind() === 'openbot';

export interface ExpertListItem {
  /** The user's agent for this expert, once added */
  agentId: string | null;
  avatar: string;
  backgroundColor: string;
  description: string;
  id: string;
  title: string;
}

/**
 * The user's expert roster: which of the catalog's experts they added, adding one (an ordinary
 * agent of theirs, never twice) and removing one.
 */
export class ExpertService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Agents the user has for catalog experts, by expert id. */
  async added(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: agents.id, marketIdentifier: agents.marketIdentifier })
      .from(agents)
      .where(
        and(
          eq(agents.userId, this.userId),
          inArray(
            agents.marketIdentifier,
            EXPERTS.map((expert) => expertMarketIdentifier(expert.id)),
          ),
        ),
      );

    const byExpert = new Map<string, string>();
    for (const row of rows) {
      const id = row.marketIdentifier!.slice(expertMarketIdentifier('').length);
      if (!byExpert.has(id)) byExpert.set(id, row.id);
    }
    return byExpert;
  }

  async list(locale: string): Promise<ExpertListItem[]> {
    const added = await this.added();

    return EXPERTS.filter(offered).map((expert) => ({
      agentId: added.get(expert.id) ?? null,
      avatar: expert.avatar,
      backgroundColor: expert.backgroundColor,
      description: localized(expert.description, locale),
      id: expert.id,
      title: localized(expert.title, locale),
    }));
  }

  /** Adds the expert, named in the user's language; adding it again returns the same agent. */
  async add(id: string, locale: string) {
    const expert = findExpert(id);
    if (!expert || !offered(expert)) return;

    const existing = (await this.added()).get(id);
    if (existing) return { agentId: existing, created: false };

    const agent = await new AgentModel(this.db, this.userId).create({
      ...(expert.agencyConfig && { agencyConfig: expert.agencyConfig }),
      avatar: expert.avatar,
      backgroundColor: expert.backgroundColor,
      // Web search and reading only: experts run unattended in group chats
      chatConfig: EXPERT_CHAT_CONFIG,
      description: localized(expert.description, locale),
      marketIdentifier: expertMarketIdentifier(expert.id),
      plugins: expert.plugins ?? EXPERT_PLUGINS,
      systemRole: expert.systemRole,
      title: localized(expert.title, locale),
      // Not virtual: removing it from a group or deleting the group must not delete it
      virtual: false,
    });
    log('userId=%s added expert %s as %s', this.userId, id, agent.id);

    return { agentId: agent.id, created: true };
  }

  /** Removes the expert's agent, and with it the chats with that agent. */
  async remove(id: string) {
    const agentId = (await this.added()).get(id);
    if (!agentId) return false;

    await new AgentModel(this.db, this.userId).delete(agentId);
    log('userId=%s removed expert %s (%s)', this.userId, id, agentId);
    return true;
  }
}
