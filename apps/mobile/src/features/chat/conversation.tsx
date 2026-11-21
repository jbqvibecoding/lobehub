import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApprovalCard } from '@/features/approvals/approval-card';
import { useRespondToApproval } from '@/features/approvals/use-approvals';
import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { AgentAvatar } from './agent-avatar';
import type { ChatLine, GroupMember, Speaker } from './types';
import { chatHistoryKey, useChatHistory, useGroup, useSendMessage, useStopRun } from './use-chat';

const TOOL_STATUS = {
  done: 'chatToolDone',
  failed: 'chatToolFailed',
  rejected: 'chatToolRejected',
} as const;

/** An `@` being typed at the end of the draft, and what follows it so far. */
const MENTION_TYPING = /(?:^|\s)@([^\s@]*)$/;

interface ConversationProps {
  /** For a new chat with someone other than Biber, e.g. an expert. */
  agentId?: string;
  api: ApiClient;
  /** For a new conversation in a group chat just started. */
  groupId?: string;
  /** Called with the new conversation once the first message of a new chat is sent. */
  onStarted: (topicId: string) => void;
  /** For a new chat: the name of who it is with. */
  title?: string;
  /** Undefined for a new chat. */
  topicId?: string;
}

/**
 * One conversation: what was said, what the agent did, and a box to write the next message. A
 * call that needs the user's answer is answered right here; while the agent works, it can be
 * stopped. A message that fails to send stays in the box.
 *
 * In a group chat each answer carries the name of who gave it (once per run of the same speaker),
 * and typing `@` offers the group's experts: a picked expert is kept by id and sent as a mention,
 * so they answer.
 */
export const Conversation = ({
  agentId,
  api,
  groupId: newGroupId,
  onStarted,
  title,
  topicId,
}: ConversationProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch } = useChatHistory(api, topicId);
  const groupId = data?.groupId ?? newGroupId;
  const group = useGroup(api, groupId);
  const send = useSendMessage(api);
  const stop = useStopRun(api);
  const respond = useRespondToApproval(api);
  const [draft, setDraft] = useState('');
  const [mentioned, setMentioned] = useState<GroupMember[]>([]);
  const [sendFailed, setSendFailed] = useState(false);
  const list = useRef<FlatList<ChatLine>>(null);

  const run = data?.run ?? 'idle';
  const canSend = draft.trim().length > 0 && !send.isPending;

  const speakers: Record<string, Speaker> = { ...data?.speakers };
  for (const member of group.data?.members ?? []) speakers[member.id] ??= member;

  const experts = (group.data?.members ?? []).filter((member) => !member.isHost);
  const typing = groupId ? MENTION_TYPING.exec(draft) : null;
  const candidates = typing
    ? experts.filter((expert) => expert.title.toLowerCase().startsWith(typing[1].toLowerCase()))
    : [];

  const placeholder = () => {
    if (groupId) return t('chatPlaceholderGroup');
    const name = (data?.agentId && speakers[data.agentId]?.title) || title;
    return name ? tf('chatPlaceholderNamed', { name }) : t('chatPlaceholder');
  };

  const mention = (expert: GroupMember) => {
    setDraft((current) =>
      current.replace(
        MENTION_TYPING,
        (match) => `${match.startsWith('@') ? '' : match[0]}@${expert.title} `,
      ),
    );
    setMentioned((current) =>
      current.some((member) => member.id === expert.id) ? current : [...current, expert],
    );
  };

  const startMention = () =>
    setDraft((current) => (current === '' || /\s$/.test(current) ? `${current}@` : `${current} @`));

  const submit = async () => {
    if (!canSend) return;
    const text = draft.trim();
    // A mention counts while its name is still in the text
    const mentions = mentioned
      .filter((member) => text.includes(`@${member.title}`))
      .map((member) => member.id);
    setSendFailed(false);
    try {
      const started = await send.mutateAsync({
        text,
        topicId,
        ...(mentions.length > 0 && { mentions }),
        ...(!topicId && agentId && { agentId }),
        ...(!topicId && newGroupId && { groupId: newGroupId }),
      });
      setDraft('');
      setMentioned([]);
      if (!topicId) onStarted(started.topicId);
    } catch {
      setSendFailed(true);
    }
  };

  const answer =
    (line: Extract<ChatLine, { kind: 'tool' }>) => async (decision: 'approved' | 'rejected') => {
      const result = await respond.mutateAsync({ decision, toolMessageId: line.id });
      if (topicId) await queryClient.invalidateQueries({ queryKey: chatHistoryKey(topicId) });
      return result;
    };

  /** Who said an answer, when it opens a run of answers from that speaker in a group chat. */
  const speakerOf = (item: ChatLine, index: number) => {
    if (!groupId || item.kind !== 'assistant' || !item.agentId) return undefined;
    const previous = data?.lines[index - 1];
    if (previous?.kind === 'assistant' && previous.agentId === item.agentId) return undefined;
    return speakers[item.agentId];
  };

  const renderLine = ({ index, item }: { index: number; item: ChatLine }) => {
    if (item.kind !== 'tool') {
      const mine = item.kind === 'user';
      const speaker = speakerOf(item, index);
      return (
        <View style={styles.line}>
          {speaker ? (
            <View style={styles.speaker}>
              <AgentAvatar
                avatar={speaker.avatar}
                backgroundColor={speaker.backgroundColor}
                size={20}
                title={speaker.title}
              />
              <Text style={styles.speakerName}>{speaker.title}</Text>
            </View>
          ) : null}
          <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
            <Text selectable style={mine ? styles.mineText : styles.theirsText}>
              {item.text}
            </Text>
          </View>
        </View>
      );
    }
    if (item.status === 'waiting') {
      return (
        <ApprovalCard
          approval={{
            apiName: item.apiName,
            arguments: item.arguments,
            createdAt: item.createdAt,
            id: item.id,
            identifier: item.identifier,
            type: item.type,
          }}
          onRespond={answer(item)}
        />
      );
    }
    return <Text style={styles.tool}>{`${item.title} · ${t(TOOL_STATUS[item.status])}`}</Text>;
  };

  const emptyState = () => {
    if (!topicId || data) return <Text style={styles.message}>{t('chatStart')}</Text>;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('chatLoadError')}</Text>
          <Pressable onPress={() => refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return isLoading ? <ActivityIndicator style={styles.centered} /> : null;
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
      style={styles.screen}
    >
      <FlatList
        contentContainerStyle={styles.list}
        data={data?.lines ?? []}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={emptyState}
        ListFooterComponent={
          run === 'running' ? (
            <View style={styles.working}>
              <ActivityIndicator />
              <Text style={styles.workingText}>{t('chatWorking')}</Text>
              <Pressable
                aria-busy={stop.isPending}
                disabled={stop.isPending || !topicId}
                onPress={() => topicId && stop.mutate(topicId)}
                role="button"
                style={styles.stop}
              >
                <Text style={styles.link}>{t('chatStop')}</Text>
              </Pressable>
            </View>
          ) : undefined
        }
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ref={list}
        renderItem={renderLine}
      />

      {sendFailed ? (
        <Text role="alert" style={styles.sendError}>
          {t('chatSendError')}
        </Text>
      ) : null}
      {candidates.length > 0 ? (
        <View role="menu" style={styles.candidates}>
          {candidates.map((expert) => (
            <Pressable
              aria-label={tf('chatMentionNamed', { name: expert.title })}
              key={expert.id}
              onPress={() => mention(expert)}
              role="menuitem"
              style={styles.candidate}
            >
              <AgentAvatar
                avatar={expert.avatar}
                backgroundColor={expert.backgroundColor}
                size={22}
                title={expert.title}
              />
              <Text style={styles.candidateName}>{expert.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composer}>
        {groupId && experts.length > 0 ? (
          <Pressable
            aria-label={t('chatMention')}
            onPress={startMention}
            role="button"
            style={styles.at}
          >
            <Text style={styles.atLabel}>@</Text>
          </Pressable>
        ) : null}
        <TextInput
          accessibilityLabel={placeholder()}
          maxLength={8000}
          multiline
          onChangeText={setDraft}
          placeholder={placeholder()}
          placeholderTextColor={colors.secondaryLabel}
          style={styles.input}
          value={draft}
        />
        <Pressable
          aria-busy={send.isPending}
          aria-label={t('chatSend')}
          disabled={!canSend}
          onPress={submit}
          role="button"
          style={[styles.send, !canSend && styles.sendDisabled]}
        >
          {send.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.sendLabel}>{t('chatSend')}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    at: { alignItems: 'center', justifyContent: 'center', minHeight: 40, minWidth: 36 },
    atLabel: { color: colors.accent, fontSize: 20, fontWeight: '600' },
    bubble: { borderRadius: 16, maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10 },
    candidate: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 16,
      flexDirection: 'row',
      gap: 6,
      minHeight: 36,
      paddingHorizontal: 10,
    },
    candidateName: { color: colors.label, fontSize: 15 },
    candidates: {
      backgroundColor: colors.card,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 8,
    },
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    composer: {
      alignItems: 'flex-end',
      backgroundColor: colors.card,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      padding: 8,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 18,
      color: colors.label,
      flex: 1,
      fontSize: 16,
      maxHeight: 140,
      minHeight: 40,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    line: { gap: 4 },
    link: { color: colors.accent, fontSize: 16 },
    list: { flexGrow: 1, padding: 16 },
    message: {
      color: colors.secondaryLabel,
      fontSize: 16,
      lineHeight: 22,
      marginTop: 48,
      textAlign: 'center',
    },
    mine: { alignSelf: 'flex-end', backgroundColor: colors.accent },
    mineText: { color: '#ffffff', fontSize: 16, lineHeight: 22 },
    screen: { backgroundColor: colors.background, flex: 1 },
    send: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 18,
      justifyContent: 'center',
      minHeight: 40,
      minWidth: 64,
      paddingHorizontal: 14,
    },
    sendDisabled: { opacity: 0.4 },
    sendError: { color: colors.danger, fontSize: 14, paddingHorizontal: 16, paddingVertical: 6 },
    sendLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    separator: { height: 10 },
    speaker: { alignItems: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 4 },
    speakerName: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '600' },
    stop: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    theirs: { alignSelf: 'flex-start', backgroundColor: colors.card },
    theirsText: { color: colors.label, fontSize: 16, lineHeight: 22 },
    tool: { color: colors.secondaryLabel, fontSize: 13, paddingHorizontal: 4 },
    working: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 12 },
    workingText: { color: colors.secondaryLabel, fontSize: 14 },
  });
