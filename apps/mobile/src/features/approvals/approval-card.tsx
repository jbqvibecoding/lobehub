import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { type StringKey, t, tf } from '@/i18n/strings';
import { type Palette, useColors } from '@/theme/colors';

import { confirmWithBiometrics } from './confirm-with-biometrics';
import { describeToolCall } from './describe-tool-call';
import { isQuestion, QuestionCard } from './question-card';
import type { ApprovalDecision, PendingApproval, QuestionAnswer, SecretKind } from './types';

const SECRET_NAMES: Record<SecretKind, StringKey> = {
  api_key: 'secretApiKey',
  card_number: 'secretCardNumber',
  id_number: 'secretIdNumber',
  password: 'secretPassword',
  private_key: 'secretPrivateKey',
};

interface ApprovalCardProps {
  approval: PendingApproval;
  /**
   * Resolves once the server took the answer; rejects to keep the card with an error. `answer`
   * comes with a coding expert's question.
   */
  onRespond: (
    decision: ApprovalDecision,
    answer?: QuestionAnswer,
  ) => Promise<{ alreadyAnswered: boolean }>;
}

/** A waiting call: a question to answer, or a call to approve or reject. */
export const ApprovalCard = (props: ApprovalCardProps) =>
  isQuestion(props.approval) ? <QuestionCard {...props} /> : <ApproveOrReject {...props} />;

const ApproveOrReject = ({ approval, onRespond }: ApprovalCardProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const summary = describeToolCall(approval);
  const [pending, setPending] = useState<ApprovalDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const respond = async (decision: ApprovalDecision) => {
    if (pending) return;
    setNotice(null);

    if (decision === 'approved' && !(await confirmWithBiometrics(t('approvePrompt')))) return;

    setPending(decision);
    try {
      const { alreadyAnswered } = await onRespond(decision);
      if (alreadyAnswered) setNotice(t('alreadyAnswered'));
    } catch {
      setNotice(t('respondError'));
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.connector}>{summary.connector}</Text>
      <Text style={styles.title}>{summary.title}</Text>

      {summary.fields.map((field) => (
        <View key={field.label} style={styles.field}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <Text style={styles.fieldValue}>{field.value}</Text>
        </View>
      ))}

      {approval.secrets?.length ? (
        <Text role="alert" style={styles.secrets}>
          {tf('approvalSecretsWarning', {
            kinds: approval.secrets.map((kind) => t(SECRET_NAMES[kind])).join(t('listSeparator')),
          })}
        </Text>
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          aria-busy={pending === 'rejected'}
          aria-label={t('reject')}
          disabled={!!pending}
          onPress={() => respond('rejected')}
          role="button"
          style={[styles.button, styles.reject]}
        >
          {pending === 'rejected' ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <Text style={styles.rejectLabel}>{t('reject')}</Text>
          )}
        </Pressable>
        <Pressable
          aria-busy={pending === 'approved'}
          aria-label={t('approve')}
          disabled={!!pending}
          onPress={() => respond('approved')}
          role="button"
          style={[styles.button, styles.approve]}
        >
          {pending === 'approved' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.approveLabel}>{t('approve')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
    approve: { backgroundColor: colors.accent },
    approveLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    button: {
      alignItems: 'center',
      borderRadius: 12,
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
    },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16 },
    connector: { color: colors.secondaryLabel, fontSize: 13 },
    field: { marginTop: 10 },
    fieldLabel: { color: colors.secondaryLabel, fontSize: 13 },
    fieldValue: { color: colors.label, fontSize: 15, marginTop: 2 },
    notice: { color: colors.danger, fontSize: 14, marginTop: 12 },
    reject: { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
    rejectLabel: { color: colors.danger, fontSize: 16, fontWeight: '600' },
    secrets: { color: colors.warning, fontSize: 14, lineHeight: 20, marginTop: 12 },
    title: { color: colors.label, fontSize: 18, fontWeight: '600', marginTop: 4 },
  });
