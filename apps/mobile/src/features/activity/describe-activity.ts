import { describeToolCall } from '@/features/approvals/describe-tool-call';
import { type StringKey, t } from '@/i18n/strings';

import type { ActivityEvent, ActivityEventType } from './types';

const REDACTED = '[REDACTED]';

export type ActivityTone = 'done' | 'problem' | 'stopped' | 'waiting';

export interface ActivitySummary {
  /** Who the call went to and what it named, without anything the server redacted. */
  details: string[];
  /** A sentence about why, when there is one: the refusal reason, the block, the error. */
  note?: string;
  status: string;
  title: string;
  tone: ActivityTone;
  /** Where the user answered, for approvals and rejections. */
  where?: string;
}

const STATUS: Record<ActivityEventType, { key: StringKey; tone: ActivityTone }> = {
  approval_requested: { key: 'eventApprovalRequested', tone: 'waiting' },
  approved: { key: 'eventApproved', tone: 'done' },
  blocked: { key: 'eventBlocked', tone: 'stopped' },
  failed: { key: 'eventFailed', tone: 'problem' },
  rejected: { key: 'eventRejected', tone: 'stopped' },
  succeeded: { key: 'eventSucceeded', tone: 'done' },
};

const BLOCK_REASONS: Record<string, StringKey> = {
  blocked_by_security_privacy: 'activityBlockedUnattended',
  disabled_by_user: 'activityBlockedByUser',
};

const WHERE: Record<string, StringKey> = { chat: 'answeredInApp', mobile: 'answeredOnPhone' };

/** One row of the activity list: what the agent did, what became of it, and why. */
export const describeActivity = (event: ActivityEvent): ActivitySummary => {
  const call = describeToolCall({
    apiName: event.apiName,
    arguments: event.payload.arguments ? JSON.stringify(event.payload.arguments) : undefined,
    identifier: event.identifier,
    type: '',
  });
  const { errorCode, rejectionReason, via } = event.payload;
  const { key, tone } = STATUS[event.eventType];

  const blockReason = errorCode && BLOCK_REASONS[errorCode];
  const note =
    event.eventType === 'rejected'
      ? rejectionReason
      : blockReason
        ? t(blockReason)
        : event.eventType === 'failed'
          ? errorCode
          : undefined;
  const answered = event.eventType === 'approved' || event.eventType === 'rejected';

  return {
    details: call.fields
      .filter((field) => field.value !== REDACTED)
      .map((field) => `${field.label}: ${field.value}`),
    note: note || undefined,
    status: t(key),
    title: `${call.title} · ${call.connector}`,
    tone,
    where: answered && via && WHERE[via] ? t(WHERE[via]) : undefined,
  };
};
