/**
 * How a chat message answers the request a paused run waits on, in a chat without buttons:
 *
 * - `approved`: "1", "approve", "yes", "批准", "同意", …
 * - `rejected`: "2", "reject", "no", "拒绝", "不同意", …
 * - `other`: anything else worth reading; the call is refused and the words go to the agent, so it
 *   can do what was asked instead.
 * - `unclear`: nothing to read (only a picture, a sticker, punctuation); the chat asks again.
 *
 * Case, surrounding spaces, punctuation and full-width digits do not matter.
 */
export type ApprovalReply = 'approved' | 'other' | 'rejected' | 'unclear';

const APPROVE = new Set(['1', 'approve', 'y', 'yes', '同意', '批准']);
const REJECT = new Set(['2', 'n', 'no', 'reject', '不同意', '拒绝']);

export const readApprovalReply = (text: string | undefined): ApprovalReply => {
  const word = (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[\s\p{P}\p{S}]+/gu, '');

  if (!word) return 'unclear';
  if (APPROVE.has(word)) return 'approved';
  if (REJECT.has(word)) return 'rejected';
  return 'other';
};
