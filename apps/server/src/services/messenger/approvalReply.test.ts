import { describe, expect, it } from 'vitest';

import { readApprovalReply } from './approvalReply';

describe('readApprovalReply', () => {
  it.each(['1', ' 1. ', '１', 'Yes!', 'y', 'APPROVE', '批准', '同意。'])(
    '"%s" approves',
    (text) => {
      expect(readApprovalReply(text)).toBe('approved');
    },
  );

  it.each(['2', '２', 'no', 'N', 'Reject.', '拒绝', '不同意！'])('"%s" rejects', (text) => {
    expect(readApprovalReply(text)).toBe('rejected');
  });

  it.each(['12', 'yes please, but cc me', '先别发', '1 but change the subject'])(
    '"%s" is something else to pass on',
    (text) => {
      expect(readApprovalReply(text)).toBe('other');
    },
  );

  it.each([undefined, '', '   ', '…', '👍'])('%j has nothing to read', (text) => {
    expect(readApprovalReply(text)).toBe('unclear');
  });
});
