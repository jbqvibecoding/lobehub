import { and, desc, eq, lt, or } from 'drizzle-orm';

import type { NewAgentActionAudit } from '../schemas/agentActionAudit';
import { agentActionAudits } from '../schemas/agentActionAudit';
import type { LobeChatDatabase } from '../type';

/** A user's trail of agent tool actions. Append-only: there is no update or delete. */
export class AgentActionAuditModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(agentActionAudits.userId, this.userId);

  async record(entry: Omit<NewAgentActionAudit, 'createdAt' | 'id' | 'userId'>) {
    const [row] = await this.db
      .insert(agentActionAudits)
      .values({ ...entry, userId: this.userId })
      .returning();

    return row;
  }

  /** Newest first; pass the last row's id as `cursor` for the next page. */
  async list({ cursor, limit = 30 }: { cursor?: string; limit?: number } = {}) {
    const conditions = [this.ownership()];

    if (cursor) {
      const [cursorRow] = await this.db
        .select({ createdAt: agentActionAudits.createdAt, id: agentActionAudits.id })
        .from(agentActionAudits)
        .where(and(eq(agentActionAudits.id, cursor), this.ownership()))
        .limit(1);

      if (cursorRow) {
        conditions.push(
          or(
            lt(agentActionAudits.createdAt, cursorRow.createdAt),
            and(
              eq(agentActionAudits.createdAt, cursorRow.createdAt),
              lt(agentActionAudits.id, cursorRow.id),
            ),
          )!,
        );
      }
    }

    return this.db
      .select()
      .from(agentActionAudits)
      .where(and(...conditions))
      .orderBy(desc(agentActionAudits.createdAt), desc(agentActionAudits.id))
      .limit(limit);
  }
}
