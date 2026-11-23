import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '@/i18n/strings';
import { type Palette, useColors } from '@/theme/colors';

import type { ApprovalDecision, PendingApproval, QuestionAnswer } from './types';

interface Question {
  header?: string;
  multiSelect?: boolean;
  options: { description?: string; label: string }[];
  question: string;
}

/** Whether a waiting call is the coding expert asking the user something, not asking leave. */
export const isQuestion = (approval: Pick<PendingApproval, 'apiName' | 'identifier'>) =>
  approval.identifier === 'claude-code' && approval.apiName === 'askUserQuestion';

/** The questions in the call's arguments; none when they cannot be read. */
export const questionsOf = (approval: Pick<PendingApproval, 'arguments'>): Question[] => {
  try {
    const parsed = JSON.parse(approval.arguments ?? '{}') as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions.filter(
      (item): item is Question => typeof item?.question === 'string' && Array.isArray(item.options),
    );
  } catch {
    return [];
  }
};

interface QuestionCardProps {
  approval: PendingApproval;
  /** Resolves once the server took the answer; rejects to keep the card with an error. */
  onRespond: (
    decision: ApprovalDecision,
    answer?: QuestionAnswer,
  ) => Promise<{ alreadyAnswered: boolean }>;
}

/**
 * The coding expert's question: each question's options to pick from, or an answer in the user's
 * own words, which Claude Code gets as it was written. Skipping tells it the user declined.
 */
export const QuestionCard = ({ approval, onRespond }: QuestionCardProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const questions = questionsOf(approval);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [ownWords, setOwnWords] = useState('');
  const [pending, setPending] = useState<ApprovalDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = (question: Question, label: string) =>
    setPicked((current) => {
      const chosen = current[question.question] ?? [];
      if (!question.multiSelect) return { ...current, [question.question]: [label] };
      return {
        ...current,
        [question.question]: chosen.includes(label)
          ? chosen.filter((item) => item !== label)
          : [...chosen, label],
      };
    });

  const answer = (): QuestionAnswer | undefined => {
    if (ownWords.trim()) return { __freeform__: ownWords.trim() };
    const entries = questions
      .filter((question) => picked[question.question]?.length)
      .map((question) => {
        const chosen = picked[question.question];
        return [question.question, question.multiSelect ? chosen : chosen[0]] as const;
      });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };

  const respond = async (decision: ApprovalDecision) => {
    if (pending) return;
    setNotice(null);
    const given = decision === 'approved' ? answer() : undefined;
    if (decision === 'approved' && !given) {
      setNotice(t('questionNeedsAnswer'));
      return;
    }

    setPending(decision);
    try {
      const { alreadyAnswered } = await onRespond(decision, given);
      if (alreadyAnswered) setNotice(t('alreadyAnswered'));
    } catch {
      setNotice(t('respondError'));
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('questionTitle')}</Text>

      {questions.map((question) => (
        <View key={question.question} style={styles.question}>
          <Text style={styles.questionText}>{question.question}</Text>
          <View style={styles.options}>
            {question.options.map((option) => {
              const selected = picked[question.question]?.includes(option.label) ?? false;
              return (
                <Pressable
                  aria-checked={selected}
                  aria-label={option.label}
                  key={option.label}
                  onPress={() => toggle(question, option.label)}
                  role={question.multiSelect ? 'checkbox' : 'radio'}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                    {option.label}
                  </Text>
                  {option.description ? (
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <TextInput
        aria-label={t('questionOwnWords')}
        multiline
        onChangeText={setOwnWords}
        placeholder={t('questionOwnWords')}
        placeholderTextColor={colors.secondaryLabel}
        style={styles.input}
        value={ownWords}
      />

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          aria-busy={pending === 'rejected'}
          aria-label={t('questionSkip')}
          disabled={!!pending}
          onPress={() => respond('rejected')}
          role="button"
          style={[styles.button, styles.skip]}
        >
          {pending === 'rejected' ? (
            <ActivityIndicator color={colors.label} />
          ) : (
            <Text style={styles.skipLabel}>{t('questionSkip')}</Text>
          )}
        </Pressable>
        <Pressable
          aria-busy={pending === 'approved'}
          aria-label={t('questionSend')}
          disabled={!!pending}
          onPress={() => respond('approved')}
          role="button"
          style={[styles.button, styles.send]}
        >
          {pending === 'approved' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.sendLabel}>{t('questionSend')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
    button: {
      alignItems: 'center',
      borderRadius: 12,
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
    },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16 },
    heading: { color: colors.secondaryLabel, fontSize: 13 },
    input: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.label,
      fontSize: 15,
      marginTop: 14,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    notice: { color: colors.danger, fontSize: 14, marginTop: 12 },
    option: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    optionDescription: { color: colors.secondaryLabel, fontSize: 13, marginTop: 2 },
    optionLabel: { color: colors.label, fontSize: 15 },
    optionLabelSelected: { color: colors.accent, fontWeight: '600' },
    optionSelected: { borderColor: colors.accent, borderWidth: 1.5 },
    options: { gap: 8, marginTop: 10 },
    question: { marginTop: 12 },
    questionText: { color: colors.label, fontSize: 17, fontWeight: '600' },
    send: { backgroundColor: colors.accent },
    sendLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    skip: { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
    skipLabel: { color: colors.label, fontSize: 16, fontWeight: '600' },
  });
