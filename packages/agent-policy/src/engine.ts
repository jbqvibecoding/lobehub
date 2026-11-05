/**
 * The only path to a side effect. The trust tier evaluation is copied from Open Instinct
 * (`packages/core/src/policy.ts`, MIT); `decideToolCall` puts Tucano's per-tool grants and its
 * "sensitive tools always ask" rule in front of it.
 */
import { approvalKey } from './approval';
import { DEFAULT_TIER_TABLE, defaultSpendPolicy, SPEND_CAPABILITIES } from './tiers';
import { classifyTool, isToolExposed } from './toolClass';
import type {
  Capability,
  Grant,
  GrantLevel,
  Permission,
  Policy,
  PolicyDecision,
  PolicyTool,
  Principal,
  Tier,
  ToolClass,
} from './types';

type Args = Record<string, unknown>;

interface CapabilityOutcome {
  decision: PolicyDecision;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const clone = <T>(value: T): T => structuredClone(value);

const textOf = (args: Args): string => {
  try {
    return JSON.stringify(args ?? '').toLowerCase();
  } catch {
    return '';
  }
};

/** Best-effort merchant name from common argument shapes (`merchant`, `vendor`, `store`). */
const merchantOf = (args: Args): string | undefined => {
  for (const key of ['merchant', 'vendor', 'store', 'restaurant', 'airline', 'hotel']) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
};

const formatUsd = (amount: number) => `$${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;

export class PolicyEngine {
  private policy: Policy;
  private readonly now: () => Date;
  private readonly spentTodayUsd: () => number;

  constructor(policy: Policy, options: { now?: () => Date; spentTodayUsd?: () => number } = {}) {
    this.policy = clone(policy);
    this.policy.grants ??= [];
    this.policy.tiers ??= {};
    this.policy.spend = { ...defaultSpendPolicy(), ...this.policy.spend };
    this.now = options.now ?? (() => new Date());
    this.spentTodayUsd = options.spentTodayUsd ?? (() => 0);
  }

  /** Tier default after overrides. Every tier has every capability, so this never misses. */
  permissionFor(tier: Tier, capability: Capability): Permission {
    return this.policy.tiers[tier]?.[capability] ?? DEFAULT_TIER_TABLE[tier][capability];
  }

  /** All capabilities must pass. Deny beats ask beats allow. */
  evaluate(
    principal: Principal,
    tool: Pick<PolicyTool, 'amountUsd' | 'capabilities' | 'describe'>,
    args: Args,
  ): PolicyDecision {
    const capabilities = tool.capabilities ?? [];
    if (capabilities.length === 0) return { outcome: 'allow', reason: 'tool needs no capability' };

    const at = this.now();
    const outcomes = capabilities.map((capability) =>
      this.evaluateOne(principal, capability, tool, args, at),
    );

    const denied = outcomes.find(({ decision }) => decision.outcome === 'deny');
    if (denied) return denied.decision;

    const asks = outcomes.filter(({ decision }) => decision.outcome === 'ask');
    if (asks.length > 0) {
      const first = asks[0].decision as Extract<PolicyDecision, { outcome: 'ask' }>;
      return {
        approvalPrompt: first.approvalPrompt,
        outcome: 'ask',
        reason: asks.map(({ decision }) => decision.reason).join('; '),
      };
    }

    const viaGrant = outcomes
      .map(({ decision }) => (decision.outcome === 'allow' ? decision.viaGrant : undefined))
      .find(Boolean);

    return {
      outcome: 'allow',
      reason: outcomes.map(({ decision }) => decision.reason).join('; '),
      ...(viaGrant ? { viaGrant } : {}),
    };
  }

  /** Used to hide tools: false only when the tier default is "no" and no active grant covers it. */
  canEver(principal: Principal, capability: Capability): boolean {
    if (this.permissionFor(principal.tier, capability) !== 'no') return true;
    return this.grantsFor(principal, this.now()).some((grant) =>
      grant.capabilities.includes(capability),
    );
  }

  addGrant(grant: Omit<Grant, 'createdAt' | 'id'>): Grant {
    const created: Grant = {
      ...clone(grant),
      createdAt: this.now().toISOString(),
      id: `g_${globalThis.crypto.randomUUID().slice(0, 8)}`,
    };
    this.policy.grants.push(created);
    return clone(created);
  }

  revokeGrant(id: string): boolean {
    const before = this.policy.grants.length;
    this.policy.grants = this.policy.grants.filter((grant) => grant.id !== id);
    return this.policy.grants.length !== before;
  }

  setTierOverride(tier: Tier, capability: Capability, permission: Permission): void {
    const row = (this.policy.tiers[tier] ??= {});

    if (permission === DEFAULT_TIER_TABLE[tier][capability]) {
      delete row[capability];
      if (Object.keys(row).length === 0) delete this.policy.tiers[tier];
      return;
    }

    row[capability] = permission;
  }

  toJSON(): Policy {
    return clone(this.policy);
  }

  private isActive(grant: Grant, at: Date): boolean {
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= at.getTime()) return false;

    const window = grant.scope?.window;
    if (window) {
      if (window.from && Date.parse(window.from) > at.getTime()) return false;
      if (window.to) {
        // Window dates may be plain days ("2026-10-06"); `to` then includes that whole day.
        const to = Date.parse(window.to);
        const end = /^\d{4}-\d{2}-\d{2}$/.test(window.to) ? to + DAY_MS : to;
        if (end <= at.getTime()) return false;
      }
    }

    return true;
  }

  /** A principal speaking at a lower tier in a shared thread brings none of its grants. */
  private grantsFor(principal: Principal, at: Date): Grant[] {
    if (principal.cappedFrom) return [];
    return this.policy.grants.filter(
      (grant) => grant.to === principal.id && this.isActive(grant, at),
    );
  }

  /**
   * The spend policy. `grantCapUsd` replaces the owner's ask threshold with a grant's cap, but
   * blocked merchants, never-without-ask words, the allow list, the per-action limit and the daily
   * total still apply, and an unknown amount still asks.
   */
  private checkSpend(
    principal: Principal,
    capability: Capability,
    amount: number | undefined,
    args: Args,
    label: string,
    grantCapUsd?: number,
  ): PolicyDecision {
    const spend = this.policy.spend;
    const asker = principal.tier === 'owner' ? '' : `${principal.displayName} asks: `;
    const ask = (reason: string): PolicyDecision => ({
      approvalPrompt: `${asker}${label}${amount === undefined ? '' : ` (${formatUsd(amount)})`}?`,
      outcome: 'ask',
      reason,
    });

    const merchant = merchantOf(args);
    if (merchant && spend.blockedMerchants.some((m) => merchant.includes(m.toLowerCase()))) {
      return { outcome: 'deny', reason: `${merchant} is on the blocked merchant list` };
    }
    if (amount === undefined) return ask(`${capability}: amount unknown, owner must confirm`);

    const flagged = spend.neverWithoutAsk.find((word) => textOf(args).includes(word.toLowerCase()));
    if (flagged) return ask(`${flagged} always needs the owner's confirmation`);

    if (
      spend.allowedMerchants.length > 0 &&
      !(merchant && spend.allowedMerchants.some((m) => merchant.includes(m.toLowerCase())))
    ) {
      return ask(`merchant${merchant ? ` ${merchant}` : ''} is not on the allowed list`);
    }
    if (amount > spend.perActionUsd) {
      return ask(
        `${formatUsd(amount)} is above the per-action limit of ${formatUsd(spend.perActionUsd)}`,
      );
    }

    const askAbove = grantCapUsd ?? spend.askAbove;
    if (amount > askAbove) {
      return ask(
        `${formatUsd(amount)} is above the ${grantCapUsd === undefined ? 'ask threshold' : 'grant cap'} of ${formatUsd(askAbove)}`,
      );
    }

    const spent = this.spentTodayUsd();
    if (spent + amount > spend.perDayUsd) {
      return ask(
        `${formatUsd(amount)} would take today's total to ${formatUsd(spent + amount)}, above the daily limit of ${formatUsd(spend.perDayUsd)}`,
      );
    }

    return {
      outcome: 'allow',
      reason: `${formatUsd(amount)} is within the ${grantCapUsd === undefined ? principal.tier : 'grant and the'} spend policy`,
    };
  }

  private evaluateOne(
    principal: Principal,
    capability: Capability,
    tool: Pick<PolicyTool, 'amountUsd' | 'describe'>,
    args: Args,
    at: Date,
  ): CapabilityOutcome {
    const permission = this.permissionFor(principal.tier, capability);
    const amount = tool.amountUsd?.(args);
    const label = tool.describe?.(args) ?? `${principal.displayName} wants ${capability}`;
    const askOwner: PolicyDecision = {
      approvalPrompt: `${principal.displayName} asks: ${label}${amount === undefined ? '' : ` (${formatUsd(amount)})`}.`,
      outcome: 'ask',
      reason: `${capability} requires the owner's approval for tier ${principal.tier}`,
    };

    // A blocked merchant is blocked for everyone; no tier, grant or approval opens it.
    if (SPEND_CAPABILITIES.has(capability) && permission !== 'no') {
      const merchant = merchantOf(args);
      if (
        merchant &&
        this.policy.spend.blockedMerchants.some((m) => merchant.includes(m.toLowerCase()))
      ) {
        return {
          decision: { outcome: 'deny', reason: `${merchant} is on the blocked merchant list` },
        };
      }
    }

    if (permission === 'no' || permission === 'ask') {
      const grant = this.grantsFor(principal, at).find((g) => g.capabilities.includes(capability));

      if (grant) {
        const max = grant.scope?.maxUsd;
        const covered = max === undefined || amount === undefined || amount <= max;

        if (covered && SPEND_CAPABILITIES.has(capability)) {
          // A grant to spend is still spending: the owner's spend policy runs with the grant cap.
          const decision = this.checkSpend(principal, capability, amount, args, label, max);
          if (decision.outcome === 'allow') decision.viaGrant = grant.id;
          return { decision };
        }

        if (covered) {
          return {
            decision: {
              outcome: 'allow',
              reason: `grant ${grant.id}${grant.note ? ` (${grant.note})` : ''} covers ${capability}`,
              viaGrant: grant.id,
            },
          };
        }

        const over = `${formatUsd(amount ?? 0)} exceeds grant ${grant.id} cap of ${formatUsd(max ?? 0)}`;
        if (permission === 'ask') return { decision: { ...askOwner, reason: over } };
        return {
          decision: {
            outcome: 'deny',
            reason: `${over} and tier ${principal.tier} has no ${capability}`,
          },
        };
      }

      if (permission === 'ask') return { decision: askOwner };
      return {
        decision: { outcome: 'deny', reason: `tier ${principal.tier} may not ${capability}` },
      };
    }

    if (permission === 'limit') {
      return { decision: this.checkSpend(principal, capability, amount, args, label) };
    }
    if (permission === 'intro') {
      return {
        decision: {
          outcome: 'allow',
          reason: `${capability} allowed as a short introduction only (tier ${principal.tier})`,
        },
      };
    }
    if (permission === 'partial') {
      return {
        decision: {
          outcome: 'allow',
          reason: `${capability} allowed in part for tier ${principal.tier}; share only what the tier may see`,
        },
      };
    }

    return { decision: { outcome: 'allow', reason: `tier ${principal.tier} may ${capability}` } };
  }
}

export interface ToolCallRequest {
  /** Tools the owner chose to always allow, as `toolKey()` values. */
  alwaysAllowed?: ReadonlySet<string>;
  args: Args;
  /** The calling agent's access to the tool's connector. */
  grant: GrantLevel | undefined;
  principal: Principal;
  tool: PolicyTool;
}

export type ToolCallDecision = PolicyDecision & {
  /** Set when the outcome is `ask`: the approval must carry this key to release the call. */
  approvalKey?: string;
  toolClass: ToolClass;
};

/** The stable name an "always allow" choice is stored under. */
export const toolKey = (tool: Pick<PolicyTool, 'connectorId' | 'name'>) =>
  `${tool.connectorId}/${tool.name}`;

const NEEDED_GRANT: Record<ToolClass, string> = {
  read: 'read',
  sensitive: 'read and write',
  write: 'read and write',
};

/**
 * Decides one tool call, in order: does the agent have access to this connector at all, does the
 * asker's tier allow what the call needs, and does a sensitive call still need the owner's yes.
 */
export const decideToolCall = (
  engine: PolicyEngine,
  { alwaysAllowed, args, grant, principal, tool }: ToolCallRequest,
): ToolCallDecision => {
  const toolClass = classifyTool(tool);

  if (!isToolExposed(toolClass, grant)) {
    return {
      outcome: 'deny',
      reason: `${tool.name} needs ${NEEDED_GRANT[toolClass]} access to ${tool.connectorId}; the agent has ${grant ?? 'none'}`,
      toolClass,
    };
  }

  const decision = engine.evaluate(principal, tool, args);
  const key = () => approvalKey(tool.connectorId, tool.name, args);

  if (decision.outcome === 'ask') return { ...decision, approvalKey: key(), toolClass };
  if (decision.outcome === 'deny') return { ...decision, toolClass };

  // Sending, paying, merging or deleting waits for the owner unless a grant or an earlier
  // "always allow" already said yes to exactly this.
  if (toolClass === 'sensitive' && !decision.viaGrant && !alwaysAllowed?.has(toolKey(tool))) {
    const label = tool.describe?.(args) ?? `${tool.name} on ${tool.connectorId}`;
    return {
      approvalKey: key(),
      approvalPrompt:
        principal.tier === 'owner' ? `${label}?` : `${principal.displayName} asks: ${label}?`,
      outcome: 'ask',
      reason: `${tool.name} changes something that is hard to undo`,
      toolClass,
    };
  }

  return { ...decision, toolClass };
};
