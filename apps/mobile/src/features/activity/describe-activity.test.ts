/**
 * @jest-environment node
 */
import { describeActivity } from './describe-activity';
import type { ActivityEvent } from './types';

const event = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  apiName: 'send_email',
  createdAt: new Date('2026-11-06T09:00:00Z'),
  eventType: 'succeeded',
  id: 'event-1',
  identifier: 'gmail-mcp',
  payload: {
    arguments: { body: '[REDACTED]', subject: 'Invoice', to: 'ana@example.com' },
  },
  ...overrides,
});

describe('describeActivity', () => {
  it('says what was done and to whom, leaving out what the server redacted', () => {
    expect(describeActivity(event({}))).toEqual({
      details: ['Subject: Invoice', 'To: ana@example.com'],
      note: undefined,
      status: 'Done',
      title: 'Send email · gmail-mcp',
      tone: 'done',
      where: undefined,
    });
  });

  it('says where an approval was given and why a call was refused', () => {
    expect(
      describeActivity(event({ eventType: 'approved', payload: { via: 'mobile' } })),
    ).toMatchObject({ status: 'Approved', where: 'on your phone' });
    expect(
      describeActivity(
        event({ eventType: 'rejected', payload: { rejectionReason: 'Wrong client', via: 'chat' } }),
      ),
    ).toMatchObject({
      note: 'Wrong client',
      status: 'Rejected',
      tone: 'stopped',
      where: 'in the app',
    });
  });

  it('explains blocks and failures', () => {
    expect(
      describeActivity(event({ eventType: 'blocked', payload: { errorCode: 'disabled_by_user' } }))
        .note,
    ).toBe('You turned this tool off.');
    expect(
      describeActivity(
        event({ eventType: 'failed', payload: { errorCode: 'MCP_EXECUTION_ERROR' } }),
      ),
    ).toMatchObject({ note: 'MCP_EXECUTION_ERROR', tone: 'problem' });
  });
});
