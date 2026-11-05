/**
 * @jest-environment node
 */
import { describeToolCall } from './describe-tool-call';
import type { PendingApproval } from './types';

const approval = (overrides: Partial<PendingApproval>): PendingApproval => ({
  createdAt: new Date(),
  id: 'tool-1',
  type: 'mcp',
  ...overrides,
});

describe('describeToolCall', () => {
  it('shows what the agent wants to do and to whom', () => {
    expect(
      describeToolCall(
        approval({
          apiName: 'send_email',
          arguments: JSON.stringify({ body: '', subject: 'Invoice', to: 'ana@example.com' }),
          identifier: 'gmail-mcp',
        }),
      ),
    ).toEqual({
      connector: 'gmail-mcp',
      fields: [
        { label: 'Subject', value: 'Invoice' },
        { label: 'To', value: 'ana@example.com' },
      ],
      title: 'Send email',
    });
  });

  it('reads camelCase names and nested values', () => {
    const summary = describeToolCall(
      approval({ apiName: 'createPaymentLink', arguments: '{"lineItems":[{"usd":20}]}' }),
    );

    expect(summary.title).toBe('Create payment link');
    expect(summary.fields).toEqual([{ label: 'Line items', value: '[{"usd":20}]' }]);
  });

  it('shortens long values and keeps arguments that are not JSON', () => {
    const long = describeToolCall(
      approval({ arguments: JSON.stringify({ body: 'x'.repeat(500) }) }),
    );
    const raw = describeToolCall(approval({ arguments: 'rm -rf build' }));

    expect(long.fields[0].value).toHaveLength(160);
    expect(raw.fields).toEqual([{ label: 'Input', value: 'rm -rf build' }]);
  });
});
