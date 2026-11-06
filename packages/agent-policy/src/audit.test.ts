import { describe, expect, it } from 'vitest';

import { approvalKey } from './approval';
import { REDACTED, redactForAudit, toolCallDigest } from './audit';

describe('redactForAudit', () => {
  it('keeps who and what, never credentials or the content sent', () => {
    expect(
      redactForAudit({
        attachments: [{ filename: 'invoice.pdf', content: 'JVBERi0x' }],
        auth: { 'access_token': 'ya29.secret', 'Api-Key': 'sk-live' },
        body: 'Dear Ana, the code is 4512',
        subject: 'Invoice',
        to: ['ana@example.com'],
      }),
    ).toEqual({
      attachments: [{ content: REDACTED, filename: 'invoice.pdf' }],
      auth: { 'access_token': REDACTED, 'Api-Key': REDACTED },
      body: REDACTED,
      subject: 'Invoice',
      to: ['ana@example.com'],
    });
  });

  it('bounds what it keeps', () => {
    const kept = redactForAudit({
      list: Array.from({ length: 25 }, (_, index) => index),
      note: 'x'.repeat(1000),
    }) as { list: unknown[]; note: string };

    expect(kept.note).toHaveLength(301);
    expect(kept.list).toHaveLength(21);
    expect(kept.list.at(-1)).toBe('…5 more');
  });
});

describe('toolCallDigest', () => {
  it('matches the approval key of the same call, whatever the key order', () => {
    expect(toolCallDigest('gmail', 'send_email', '{"to":"ana@example.com","subject":"Hi"}')).toBe(
      approvalKey('gmail', 'send_email', { subject: 'Hi', to: 'ana@example.com' }),
    );
  });

  it('changes when an argument changes, and accepts arguments that are not JSON', () => {
    const digest = toolCallDigest('stripe', 'pay', '{"amount":20}');

    expect(toolCallDigest('stripe', 'pay', '{"amount":2000}')).not.toBe(digest);
    expect(toolCallDigest('shell', 'run', 'rm -rf build')).toBe(
      approvalKey('shell', 'run', { input: 'rm -rf build' }),
    );
  });
});
