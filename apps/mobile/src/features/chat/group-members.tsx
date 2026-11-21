import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useExperts } from '@/features/settings/use-experts';
import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { AgentAvatar } from './agent-avatar';
import type { GroupMember } from './types';
import { useGroup, useUpdateGroup } from './use-chat';

/** Experts in one group, at most; the server holds the same limit. */
const GROUP_LIMIT = 8;

/**
 * Who is in a group chat: Biber hosts and stays; experts can be removed, as long as one is left,
 * and the user's other experts added.
 */
export const GroupMembers = ({ api, groupId }: { api: ApiClient; groupId: string }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const group = useGroup(api, groupId);
  const roster = useExperts(api);
  const update = useUpdateGroup(api, groupId);

  if (!group.data) {
    if (group.error) {
      return (
        <View style={[styles.screen, styles.centered]}>
          <Text style={styles.message}>{t('groupMembersError')}</Text>
          <Pressable onPress={() => group.refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={[styles.screen, styles.centered]} />;
  }

  const members = group.data.members;
  const experts = members.filter((member) => !member.isHost);
  const addable = (roster.data ?? []).filter(
    (expert) => expert.agentId && !members.some((member) => member.id === expert.agentId),
  );
  const full = experts.length >= GROUP_LIMIT;

  const confirmRemove = (member: GroupMember) =>
    Alert.alert(tf('groupRemoveTitle', { name: member.title }), t('groupRemoveBody'), [
      { style: 'cancel', text: t('cancel') },
      {
        onPress: () => update.mutate({ removeExpertIds: [member.id] }),
        style: 'destructive',
        text: t('expertRemove'),
      },
    ]);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
    >
      <View style={styles.card}>
        {members.map((member, index) => (
          <View key={member.id} style={[styles.row, index > 0 && styles.divider]}>
            <AgentAvatar
              avatar={member.avatar}
              backgroundColor={member.backgroundColor}
              size={32}
              title={member.title}
            />
            <View style={styles.body}>
              <Text style={styles.name}>{member.title}</Text>
              {member.isHost ? <Text style={styles.note}>{t('groupHost')}</Text> : null}
            </View>
            {member.isHost ? null : (
              <Pressable
                aria-disabled={update.isPending || experts.length <= 1}
                aria-label={tf('groupRemoveTitle', { name: member.title })}
                disabled={update.isPending || experts.length <= 1}
                onPress={() => confirmRemove(member)}
                role="button"
                style={[styles.action, experts.length <= 1 && styles.disabled]}
              >
                <Text style={styles.danger}>{t('expertRemove')}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
      <Text style={styles.hint}>{t('groupMembersLimit')}</Text>
      {update.isError ? (
        <Text role="alert" style={styles.error}>
          {t('expertChangeError')}
        </Text>
      ) : null}

      {addable.length > 0 ? (
        <>
          <Text role="heading" style={styles.section}>
            {t('groupAddSection')}
          </Text>
          <View style={styles.card}>
            {addable.map((expert, index) => (
              <View key={expert.id} style={[styles.row, index > 0 && styles.divider]}>
                <AgentAvatar
                  avatar={expert.avatar}
                  backgroundColor={expert.backgroundColor}
                  size={32}
                  title={expert.title}
                />
                <Text style={[styles.name, styles.body]}>{expert.title}</Text>
                <Pressable
                  aria-disabled={update.isPending || full}
                  aria-label={tf('groupAddNamed', { name: expert.title })}
                  disabled={update.isPending || full}
                  onPress={() => update.mutate({ addExpertIds: [expert.agentId!] })}
                  role="button"
                  style={[styles.action, full && styles.disabled]}
                >
                  <Text style={styles.link}>{t('groupAdd')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    action: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 4 },
    body: { flex: 1, gap: 2 },
    card: { backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14 },
    centered: { alignItems: 'center', gap: 12, justifyContent: 'center' },
    content: { gap: 8, padding: 16, paddingBottom: 32 },
    danger: { color: colors.danger, fontSize: 15 },
    disabled: { opacity: 0.4 },
    divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    error: { color: colors.danger, fontSize: 14 },
    hint: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
    link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    message: { color: colors.secondaryLabel, fontSize: 16, textAlign: 'center' },
    name: { color: colors.label, fontSize: 16, fontWeight: '600' },
    note: { color: colors.secondaryLabel, fontSize: 13 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 52, paddingVertical: 8 },
    screen: { backgroundColor: colors.background, flex: 1 },
    section: {
      color: colors.secondaryLabel,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 16,
      textTransform: 'uppercase',
    },
  });
