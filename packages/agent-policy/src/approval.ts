/**
 * An approval is bound to one exact call: the same connector, tool and arguments. A changed draft
 * is a different call and needs its own yes (Tucano's approval hash). Only a pending approval can
 * be resolved, so a second tap on the same card changes nothing (OpenGrokBot). An approval nobody
 * answers in time counts as a refusal (OpenHuman's ten-minute gate).
 */
import { sha256 } from 'js-sha256';

export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

export type ApprovalStatus = 'approved' | 'denied' | 'expired' | 'pending';

export interface ApprovalRecord {
  createdAt: number;
  expiresAt: number;
  key: string;
  prompt: string;
  /** The refusal reason the agent reads, when one was given. */
  reason?: string;
  resolvedAt?: number;
  resolvedBy?: string;
  status: ApprovalStatus;
}

export type ApprovalResolution = 'applied' | 'already-resolved' | 'expired';

/** The same JSON for the same arguments, whatever their key order. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};

export const approvalKey = (connectorId: string, tool: string, args: Record<string, unknown>) =>
  sha256(`${connectorId}\n${tool}\n${canonicalJson(args)}`);

export const openApproval = ({
  key,
  now = Date.now(),
  prompt,
  ttlMs = DEFAULT_APPROVAL_TTL_MS,
}: {
  key: string;
  now?: number;
  prompt: string;
  ttlMs?: number;
}): ApprovalRecord => ({ createdAt: now, expiresAt: now + ttlMs, key, prompt, status: 'pending' });

/** A pending approval past its deadline reads as expired, even before anything rewrote it. */
export const approvalStatusAt = (record: ApprovalRecord, now = Date.now()): ApprovalStatus =>
  record.status === 'pending' && now >= record.expiresAt ? 'expired' : record.status;

export const resolveApproval = (
  record: ApprovalRecord,
  {
    by,
    decision,
    now = Date.now(),
    reason,
  }: { by: string; decision: 'approve' | 'deny'; now?: number; reason?: string },
): { record: ApprovalRecord; resolution: ApprovalResolution } => {
  if (record.status !== 'pending') return { record, resolution: 'already-resolved' };

  if (approvalStatusAt(record, now) === 'expired') {
    return { record: { ...record, resolvedAt: now, status: 'expired' }, resolution: 'expired' };
  }

  return {
    record: {
      ...record,
      ...(reason ? { reason } : {}),
      resolvedAt: now,
      resolvedBy: by,
      status: decision === 'approve' ? 'approved' : 'denied',
    },
    resolution: 'applied',
  };
};

/** Whether this approval releases this exact call. */
export const approvalReleases = (
  record: ApprovalRecord,
  call: { args: Record<string, unknown>; connectorId: string; tool: string },
) =>
  record.status === 'approved' &&
  record.key === approvalKey(call.connectorId, call.tool, call.args);
