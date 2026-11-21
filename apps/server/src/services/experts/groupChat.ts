import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq, inArray } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { TopicModel } from '@/database/models/topic';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { agents, chatGroupsAgents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import { HOST_INSTRUCTIONS, mentionedInstructions } from './host';

const log = debug('lobe-server:experts:group');

/** Experts in one group, at most */
export const GROUP_MEMBER_LIMIT = 8;

export interface GroupMember {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  isHost: boolean;
  title: string;
}

const BIBER_TITLE = 'Biber';

const groupTitle = (names: string[], locale: string) =>
  locale.toLowerCase().startsWith('zh')
    ? `Biber 和${names.join('、')}`
    : `Biber, ${names.join(', ')}`;

/**
 * Group chats Biber hosts with the user's experts, as the phone drives them: start one, see and
 * change who is in it, and send a message. Who answers follows the user's mentions: one expert
 * mentioned answers directly; otherwise Biber answers and brings experts in as it sees fit, or
 * exactly the experts the user mentioned. Runs started here wait for the user's approval as the
 * phone's other chats do.
 */
export class GroupChatService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private async biber() {
    const biber = await new AgentModel(this.db, this.userId, this.workspaceId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.inbox,
    );
    if (!biber) throw new TRPCError({ code: 'NOT_FOUND', message: 'Biber is not set up' });
    return biber;
  }

  /** The user's agents among `ids`, with their names, in the given order. */
  private async ownAgents(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: agents.id, title: agents.title })
      .from(agents)
      .where(and(eq(agents.userId, this.userId), inArray(agents.id, ids)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (ids.some((id) => !byId.has(id))) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Expert not found' });
    }
    return ids.map((id) => byId.get(id)!);
  }

  async start({
    expertIds,
    locale,
    title,
  }: {
    expertIds: string[];
    locale: string;
    title?: string;
  }) {
    const biber = await this.biber();
    const ids = [...new Set(expertIds)].filter((id) => id !== biber.id);
    if (ids.length === 0 || ids.length > GROUP_MEMBER_LIMIT) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A group needs 1 to ${GROUP_MEMBER_LIMIT} experts`,
      });
    }
    const experts = await this.ownAgents(ids);

    const { group } = await new AgentGroupRepository(
      this.db,
      this.userId,
      this.workspaceId,
    ).createHostedGroup({
      hostAgentId: biber.id,
      memberIds: ids,
      title:
        title?.trim() ||
        groupTitle(
          experts.map((expert) => expert.title || '?'),
          locale,
        ),
    });
    log('userId=%s started group %s with %d experts', this.userId, group.id, ids.length);
    return { groupId: group.id, title: group.title };
  }

  /** Who is in the group, the host (Biber) first. */
  async members(groupId: string): Promise<GroupMember[]> {
    const group = await new ChatGroupModel(this.db, this.userId, this.workspaceId).findById(
      groupId,
    );
    if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such group' });

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        role: chatGroupsAgents.role,
        slug: agents.slug,
        title: agents.title,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(
        and(eq(chatGroupsAgents.chatGroupId, groupId), eq(chatGroupsAgents.userId, this.userId)),
      )
      .orderBy(chatGroupsAgents.order);

    return rows.map((row) => ({
      avatar: row.avatar,
      backgroundColor: row.backgroundColor,
      id: row.id,
      isHost: row.role === 'supervisor',
      title: row.title || (row.slug === BUILTIN_AGENT_SLUGS.inbox ? BIBER_TITLE : '?'),
    }));
  }

  async update({
    addExpertIds = [],
    groupId,
    removeExpertIds = [],
  }: {
    addExpertIds?: string[];
    groupId: string;
    removeExpertIds?: string[];
  }) {
    const members = await this.members(groupId);
    const host = members.find((member) => member.isHost);
    if (host && removeExpertIds.includes(host.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Biber hosts the group and stays' });
    }

    const groups = new ChatGroupModel(this.db, this.userId, this.workspaceId);
    const adding = addExpertIds.filter((id) => !members.some((member) => member.id === id));
    const remaining =
      members.filter((member) => !member.isHost && !removeExpertIds.includes(member.id)).length +
      adding.length;
    if (remaining === 0 || remaining > GROUP_MEMBER_LIMIT) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A group needs 1 to ${GROUP_MEMBER_LIMIT} experts`,
      });
    }

    if (adding.length > 0) {
      await this.ownAgents(adding);
      await groups.addAgentsToGroup(groupId, adding);
    }
    for (const id of removeExpertIds) await groups.removeAgentFromGroup(groupId, id);

    return this.members(groupId);
  }

  /**
   * Sends the user's message into the group's chat (a new one when `topicId` is absent).
   * `mentions` are the experts the user addressed, by agent id; they must be in the group.
   */
  async send({
    groupId,
    mentions = [],
    text,
    topicId,
  }: {
    groupId: string;
    mentions?: string[];
    text: string;
    topicId?: string;
  }) {
    const members = await this.members(groupId);
    const host = members.find((member) => member.isHost);
    if (!host) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The group has no host' });

    const addressed = [...new Set(mentions)].map((id) => {
      const member = members.find((candidate) => candidate.id === id && !candidate.isHost);
      if (!member) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mentioned someone not in the group' });
      }
      return member;
    });

    const topics = new TopicModel(this.db, this.userId, this.workspaceId);
    if (topicId) {
      const topic = await topics.findById(topicId);
      if (!topic || topic.groupId !== groupId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No such conversation' });
      }
    }

    const aiAgent = new AiAgentService(this.db, this.userId, { workspaceId: this.workspaceId });
    const userInterventionConfig = { approvalMode: 'manual' as const };

    // One expert addressed: they answer directly, Biber stays out of it
    if (addressed.length === 1) {
      let chatId = topicId;
      if (!chatId) {
        const topic = await topics.create({
          agentId: host.id,
          groupId,
          title: text.slice(0, 50),
        });
        chatId = topic.id;
      }
      log('group %s: @%s answers directly', groupId, addressed[0].id);
      const result = await aiAgent.execAgent({
        agentId: addressed[0].id,
        appContext: { groupId, topicId: chatId },
        prompt: text,
        trigger: RequestTrigger.Chat,
        userInterventionConfig,
      });
      return { operationId: result.operationId, topicId: chatId };
    }

    log('group %s: Biber hosts (%d mentioned)', groupId, addressed.length);
    const result = await aiAgent.execGroupAgent({
      agentId: host.id,
      groupId,
      instructions:
        addressed.length > 1
          ? `${HOST_INSTRUCTIONS}\n\n${mentionedInstructions(addressed.map((member) => member.title))}`
          : HOST_INSTRUCTIONS,
      message: text,
      topicId,
      userInterventionConfig,
    });
    return { operationId: result.operationId, topicId: result.topicId };
  }
}
