import { approvalKey } from '@lobechat/agent-policy';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentActionAuditModel } from '@/database/models/agentActionAudit';
import { users } from '@/database/schemas/user';

import { isAuditedRun, recordAgentAction } from '../index';

const db = await getTestDB();
const userId = 'agent-action-audit-user';

const sendEmail = {
  apiName: 'send_email',
  arguments: '{"to":"ana@example.com","subject":"Invoice","body":"the code is 4512"}',
  id: 'call-1',
  identifier: 'gmail-mcp',
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('recordAgentAction', () => {
  it('keeps who the call was for and a digest of the exact call, not what it said', async () => {
    await recordAgentAction(
      db,
      'approved',
      sendEmail,
      { agentId: 'agent-1', operationId: 'op-1', topicId: 'topic-1', userId },
      { via: 'mobile' },
    );

    const [row] = await new AgentActionAuditModel(db, userId).list();
    expect(row).toMatchObject({
      agentId: 'agent-1',
      apiName: 'send_email',
      callDigest: approvalKey('gmail-mcp', 'send_email', {
        body: 'the code is 4512',
        subject: 'Invoice',
        to: 'ana@example.com',
      }),
      eventType: 'approved',
      operationId: 'op-1',
      payload: {
        arguments: { body: '[REDACTED]', subject: 'Invoice', to: 'ana@example.com' },
        via: 'mobile',
      },
      toolCallId: 'call-1',
      toolClass: 'sensitive',
      topicId: 'topic-1',
    });
  });

  it('does not throw when the row cannot be written', async () => {
    await expect(
      recordAgentAction(db, 'succeeded', sendEmail, { userId: 'no-such-user' }),
    ).resolves.toBeUndefined();
  });
});

describe('isAuditedRun', () => {
  it('records runs that can change something, and skips reads', () => {
    expect(isAuditedRun('send_email')).toBe(true);
    expect(isAuditedRun('writeLocalFile')).toBe(true);
    expect(isAuditedRun('searchRepositories')).toBe(false);
  });
});
