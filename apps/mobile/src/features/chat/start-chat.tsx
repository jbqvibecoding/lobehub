import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useExperts } from '@/features/settings/use-experts';
import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { AgentAvatar } from './agent-avatar';
import { useStartGroup } from './use-chat';

/** Experts in one group, at most; the server holds the same limit. */
const GROUP_LIMIT = 8;

/** Where a new chat goes: Biber or one expert (`agentId`), or a group just started. */
export type ChatTarget =
  | { agentId?: string; kind: 'agent'; title: string }
  | { groupId: string; kind: 'group'; title: string };

interface StartChatProps {
  api: ApiClient;
  onOpenExperts: () => void;
  onStart: (target: ChatTarget) => void;
}

/**
 * Starting a chat: with Biber, with one of the user's experts, or a group chat Biber hosts with
 * the experts the user picks. Without experts, it points to where they are added.
 */
export const StartChat = ({ api, onOpenExperts, onStart }: StartChatProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data, error, isLoading, refetch } = useExperts(api);
  const startGroup = useStartGroup(api);
  const [picked, setPicked] = useState<string[]>([]);

  const added = (data ?? []).filter((expert) => expert.agentId);
  const canStartGroup = picked.length > 0 && !startGroup.isPending;

  const toggle = (agentId: string) =>
    setPicked((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : current.length < GROUP_LIMIT
          ? [...current, agentId]
          : current,
    );

  const start = async () => {
    if (!canStartGroup) return;
    try {
      const group = await startGroup.mutateAsync({
        expertIds: picked,
        locale: getLocales()[0]?.languageTag,
      });
      onStart({
        groupId: group.groupId,
        kind: 'group',
        title: group.title ?? t('chatGroupFallbackTitle'),
      });
    } catch {
      // Shown below from the mutation's state; the picks stay
    }
  };

  const experts = () => {
    if (data === undefined) {
      if (error) {
        return (
          <View style={styles.centered}>
            <Text style={styles.message}>{t('expertsError')}</Text>
            <Pressable onPress={() => refetch()} role="button">
              <Text style={styles.link}>{t('retry')}</Text>
            </Pressable>
          </View>
        );
      }
      return isLoading ? <ActivityIndicator style={styles.centered} /> : null;
    }

    if (added.length === 0) {
      return (
        <View style={styles.card}>
          <Text style={styles.hint}>{t('chatStartNoExperts')}</Text>
          <Pressable onPress={onOpenExperts} role="button" style={styles.action}>
            <Text style={styles.link}>{t('chatStartOpenExperts')}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <>
        <Text role="heading" style={styles.section}>
          {t('chatStartExperts')}
        </Text>
        <View style={styles.card}>
          {added.map((expert, index) => (
            <Pressable
              aria-label={tf('expertChatWith', { name: expert.title })}
              key={expert.id}
              onPress={() =>
                onStart({ agentId: expert.agentId!, kind: 'agent', title: expert.title })
              }
              role="button"
              style={[styles.option, index > 0 && styles.divider]}
            >
              <AgentAvatar
                avatar={expert.avatar}
                backgroundColor={expert.backgroundColor}
                size={32}
                title={expert.title}
              />
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>{expert.title}</Text>
                <Text numberOfLines={2} style={styles.optionHint}>
                  {expert.description}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text role="heading" style={styles.section}>
          {t('chatStartGroup')}
        </Text>
        <Text style={styles.hint}>{t('chatStartGroupHint')}</Text>
        <View style={styles.card}>
          {added.map((expert, index) => {
            const checked = picked.includes(expert.agentId!);
            return (
              <Pressable
                aria-checked={checked}
                aria-label={expert.title}
                key={expert.id}
                onPress={() => toggle(expert.agentId!)}
                role="checkbox"
                style={[styles.option, index > 0 && styles.divider]}
              >
                <AgentAvatar
                  avatar={expert.avatar}
                  backgroundColor={expert.backgroundColor}
                  size={28}
                  title={expert.title}
                />
                <Text style={[styles.optionTitle, styles.optionBody]}>{expert.title}</Text>
                <Text style={styles.check}>{checked ? '✓' : ''}</Text>
              </Pressable>
            );
          })}
        </View>
        {startGroup.isError ? (
          <Text role="alert" style={styles.error}>
            {t('chatStartGroupError')}
          </Text>
        ) : null}
        <Pressable
          aria-busy={startGroup.isPending}
          aria-disabled={!canStartGroup}
          disabled={!canStartGroup}
          onPress={start}
          role="button"
          style={[styles.primary, !canStartGroup && styles.disabled]}
        >
          {startGroup.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryLabel}>{t('chatStartGroupButton')}</Text>
          )}
        </Pressable>
      </>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
    >
      <View style={styles.card}>
        <Pressable
          aria-label={tf('chatPlaceholderNamed', { name: 'Biber' })}
          onPress={() => onStart({ kind: 'agent', title: 'Biber' })}
          role="button"
          style={styles.option}
        >
          <AgentAvatar size={32} title="Biber" />
          <View style={styles.optionBody}>
            <Text style={styles.optionTitle}>Biber</Text>
            <Text style={styles.optionHint}>{t('chatStartBiberHint')}</Text>
          </View>
        </Pressable>
      </View>
      {experts()}
    </ScrollView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    action: { minHeight: 44, justifyContent: 'center' },
    card: { backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14 },
    centered: { alignItems: 'center', gap: 12, marginTop: 32 },
    check: { color: colors.accent, fontSize: 18, fontWeight: '600', width: 24 },
    content: { gap: 8, padding: 16, paddingBottom: 32 },
    disabled: { opacity: 0.4 },
    divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    error: { color: colors.danger, fontSize: 14 },
    hint: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20, paddingVertical: 4 },
    link: { color: colors.accent, fontSize: 16 },
    message: { color: colors.secondaryLabel, fontSize: 16, textAlign: 'center' },
    option: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: 52,
      paddingVertical: 10,
    },
    optionBody: { flex: 1, gap: 2 },
    optionHint: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
    optionTitle: { color: colors.label, fontSize: 16, fontWeight: '600' },
    primary: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 44,
    },
    primaryLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    screen: { backgroundColor: colors.background, flex: 1 },
    section: {
      color: colors.secondaryLabel,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 16,
      textTransform: 'uppercase',
    },
  });
