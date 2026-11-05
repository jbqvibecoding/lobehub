import { describe, expect, it } from 'vitest';

import { decideToolCall, PolicyEngine, toolKey } from './engine';
import { defaultPolicy } from './tiers';
import type { PolicyTool, Principal } from './types';

const owner: Principal = { displayName: 'Maria', id: 'owner', tier: 'owner' };
const sam: Principal = { displayName: 'Sam', id: 'contact:sam', tier: 'partner' };
const stranger: Principal = {
  displayName: '+1 555 0100',
  id: 'stranger:sms:+15550100',
  tier: 'stranger',
};

const at = new Date('2026-11-05T12:00:00Z');
const engine = (policy = defaultPolicy(), spentTodayUsd = 0) =>
  new PolicyEngine(policy, { now: () => at, spentTodayUsd: () => spentTodayUsd });

const purchase: PolicyTool = {
  amountUsd: (args) => (typeof args.totalUsd === 'number' ? args.totalUsd : undefined),
  capabilities: ['purchase'],
  connectorId: 'stripe-link',
  describe: (args) => `buy from ${String(args.merchant)}`,
  name: 'createSpendRequest',
};

describe('PolicyEngine tiers', () => {
  it('lets a partner read the calendar but asks before they change it', () => {
    expect(engine().evaluate(sam, { capabilities: ['calendar.read'] }, {}).outcome).toBe('allow');
    expect(engine().evaluate(sam, { capabilities: ['calendar.write'] }, {})).toMatchObject({
      approvalPrompt: 'Sam asks: Sam wants calendar.write.',
      outcome: 'ask',
    });
  });

  it('never lets a stranger send email as the owner', () => {
    expect(engine().evaluate(stranger, { capabilities: ['email.send'] }, {})).toEqual({
      outcome: 'deny',
      reason: 'tier stranger may not email.send',
    });
  });

  it('needs every capability a call asks for; deny beats ask', () => {
    const decision = engine().evaluate(sam, { capabilities: ['calendar.write', 'email.read'] }, {});
    expect(decision.outcome).toBe('deny');
  });

  it('opens a capability through a plain-words grant until it expires', () => {
    const policy = engine();
    const grant = policy.addGrant({
      capabilities: ['email.send'],
      expiresAt: '2026-11-06T00:00:00Z',
      note: 'Sam can email the caterer this week',
      to: 'contact:sam',
    });

    expect(policy.evaluate(sam, { capabilities: ['email.send'] }, {})).toMatchObject({
      outcome: 'allow',
      viaGrant: grant.id,
    });

    const later = new PolicyEngine(policy.toJSON(), {
      now: () => new Date('2026-11-07T00:00:00Z'),
    });
    expect(later.evaluate(sam, { capabilities: ['email.send'] }, {}).outcome).toBe('ask');
  });

  it('drops grants when a trusted person speaks in a shared thread', () => {
    const policy = engine();
    policy.addGrant({ capabilities: ['email.send'], to: 'contact:sam' });

    const inGroup: Principal = { ...sam, cappedFrom: 'partner', tier: 'friend' };
    expect(policy.evaluate(inGroup, { capabilities: ['email.send'] }, {}).outcome).toBe('deny');
  });
});

describe('PolicyEngine spending', () => {
  it('lets the owner spend under the ask threshold and asks above it', () => {
    expect(engine().evaluate(owner, purchase, { merchant: 'Bakery', totalUsd: 20 }).outcome).toBe(
      'allow',
    );
    expect(engine().evaluate(owner, purchase, { merchant: 'Bakery', totalUsd: 80 })).toMatchObject({
      approvalPrompt: 'buy from Bakery ($80)?',
      outcome: 'ask',
    });
  });

  it('asks when the amount is unknown or the day would run over', () => {
    expect(engine().evaluate(owner, purchase, { merchant: 'Bakery' }).outcome).toBe('ask');
    expect(engine(defaultPolicy(), 290).evaluate(owner, purchase, { totalUsd: 20 }).outcome).toBe(
      'ask',
    );
  });

  it('blocks a blocked merchant for everyone, owner included', () => {
    const policy = defaultPolicy();
    policy.spend.blockedMerchants = ['casino'];

    expect(
      engine(policy).evaluate(owner, purchase, { merchant: 'Lucky Casino', totalUsd: 5 }),
    ).toEqual({ outcome: 'deny', reason: 'lucky casino is on the blocked merchant list' });
  });
});

describe('decideToolCall', () => {
  const sendEmail: PolicyTool = {
    capabilities: ['email.send'],
    connectorId: 'gmail',
    describe: (args) => `send "${String(args.subject)}" to ${String(args.to)}`,
    name: 'sendEmail',
  };
  const listIssues: PolicyTool = { connectorId: 'github', name: 'listIssues' };
  const createIssue: PolicyTool = { connectorId: 'github', name: 'createIssue' };

  it('refuses tools on connectors the agent was not given', () => {
    expect(
      decideToolCall(engine(), { args: {}, grant: undefined, principal: owner, tool: listIssues }),
    ).toMatchObject({ outcome: 'deny', toolClass: 'read' });
  });

  it('exposes only read tools to a read grant', () => {
    expect(
      decideToolCall(engine(), { args: {}, grant: 'read', principal: owner, tool: listIssues })
        .outcome,
    ).toBe('allow');
    expect(
      decideToolCall(engine(), { args: {}, grant: 'read', principal: owner, tool: createIssue }),
    ).toMatchObject({
      outcome: 'deny',
      reason: 'createIssue needs read and write access to github; the agent has read',
    });
  });

  it('asks the owner before a sensitive call even when the tier allows it', () => {
    const decision = decideToolCall(engine(), {
      args: { subject: 'Invoice', to: 'ana@example.com' },
      grant: 'read_write',
      principal: owner,
      tool: sendEmail,
    });

    expect(decision).toMatchObject({
      approvalPrompt: 'send "Invoice" to ana@example.com?',
      outcome: 'ask',
      toolClass: 'sensitive',
    });
    expect(decision.approvalKey).toMatch(/^[\da-f]{64}$/);
  });

  it('skips the question once the owner chose to always allow that tool', () => {
    expect(
      decideToolCall(engine(), {
        alwaysAllowed: new Set([toolKey(sendEmail)]),
        args: { subject: 'Invoice', to: 'ana@example.com' },
        grant: 'read_write',
        principal: owner,
        tool: sendEmail,
      }).outcome,
    ).toBe('allow');
  });

  it('lets a grant stand in for the owner on a sensitive call', () => {
    const policy = engine();
    policy.addGrant({ capabilities: ['email.send'], to: 'contact:sam' });

    expect(
      decideToolCall(policy, { args: {}, grant: 'read_write', principal: sam, tool: sendEmail })
        .outcome,
    ).toBe('allow');
  });

  it('runs ordinary writes without asking', () => {
    expect(
      decideToolCall(engine(), {
        args: {},
        grant: 'read_write',
        principal: owner,
        tool: createIssue,
      }).outcome,
    ).toBe('allow');
  });
});
