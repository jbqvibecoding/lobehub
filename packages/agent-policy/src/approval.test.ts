import { describe, expect, it } from 'vitest';

import {
  approvalKey,
  approvalReleases,
  approvalStatusAt,
  openApproval,
  resolveApproval,
} from './approval';
import { classifyTool } from './toolClass';

const call = {
  args: { body: 'Hi', to: 'ana@example.com' },
  connectorId: 'gmail',
  tool: 'sendEmail',
};

describe('approvals', () => {
  it('binds an approval to the exact arguments, whatever their order', () => {
    const key = approvalKey(call.connectorId, call.tool, call.args);

    expect(approvalKey('gmail', 'sendEmail', { to: 'ana@example.com', body: 'Hi' })).toBe(key);
    expect(approvalKey('gmail', 'sendEmail', { body: 'Hi!', to: 'ana@example.com' })).not.toBe(key);
  });

  it('resolves once; a second tap changes nothing', () => {
    const pending = openApproval({
      key: approvalKey(call.connectorId, call.tool, call.args),
      now: 0,
      prompt: 'send?',
    });

    const first = resolveApproval(pending, { by: 'owner', decision: 'approve', now: 1000 });
    const second = resolveApproval(first.record, { by: 'owner', decision: 'deny', now: 2000 });

    expect(first.resolution).toBe('applied');
    expect(second).toEqual({ record: first.record, resolution: 'already-resolved' });
    expect(approvalReleases(first.record, call)).toBe(true);
    expect(
      approvalReleases(first.record, { ...call, args: { ...call.args, body: 'Changed' } }),
    ).toBe(false);
  });

  it('treats an unanswered approval as refused once its time is up', () => {
    const pending = openApproval({ key: 'k', now: 0, prompt: 'send?', ttlMs: 1000 });

    expect(approvalStatusAt(pending, 999)).toBe('pending');
    expect(approvalStatusAt(pending, 1000)).toBe('expired');

    const late = resolveApproval(pending, { by: 'owner', decision: 'approve', now: 5000 });
    expect(late.resolution).toBe('expired');
    expect(approvalReleases(late.record, { args: {}, connectorId: 'x', tool: 'y' })).toBe(false);
  });

  it('keeps the refusal reason for the agent to read', () => {
    const pending = openApproval({ key: 'k', now: 0, prompt: 'send?' });
    const { record } = resolveApproval(pending, {
      by: 'owner',
      decision: 'deny',
      now: 10,
      reason: 'Wait until Monday',
    });

    expect(record).toMatchObject({ reason: 'Wait until Monday', status: 'denied' });
  });
});

describe('classifyTool', () => {
  it('trusts annotations over the name', () => {
    expect(classifyTool({ annotations: { readOnlyHint: true }, name: 'deleteDraft' })).toBe('read');
    expect(classifyTool({ annotations: { destructiveHint: true }, name: 'getThing' })).toBe(
      'sensitive',
    );
  });

  it('reads names in either case style, with sensitive words winning', () => {
    expect(classifyTool({ name: 'list_issues' })).toBe('read');
    expect(classifyTool({ name: 'createIssue' })).toBe('write');
    expect(classifyTool({ name: 'merge_pull_request' })).toBe('sensitive');
    expect(classifyTool({ name: 'getAndDeleteMessages' })).toBe('sensitive');
  });
});
