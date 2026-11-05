/** How much the owner trusts a person, and so what that person may have their agent do. */
export type Tier = 'owner' | 'partner' | 'family' | 'friend' | 'contact' | 'stranger';

export const TIER_ORDER: readonly Tier[] = [
  'owner',
  'partner',
  'family',
  'friend',
  'contact',
  'stranger',
];

/** What a tool call needs. A call is allowed only when every capability it needs is. */
export type Capability =
  | 'converse'
  | 'owner.relay'
  | 'owner.profile.public'
  | 'owner.profile.preferences'
  | 'owner.location.exact'
  | 'owner.location.approx'
  | 'calendar.freebusy'
  | 'calendar.read'
  | 'calendar.write'
  | 'email.read'
  | 'email.send'
  | 'contacts.read'
  | 'plans.propose'
  | 'plans.commit'
  | 'purchase'
  | 'travel.book'
  | 'computer.use'
  | 'files.read'
  | 'files.write'
  | 'memory.write'
  | 'network.ask'
  | 'network.invite'
  | 'trust.manage'
  | 'schedule.manage'
  | 'web.read'
  | 'apps.use';

/**
 * A tier's default for one capability. `limit` runs the spend policy; `intro` and `partial` are
 * allowed outcomes that tell the agent to share only a little.
 */
export type Permission = 'yes' | 'ask' | 'limit' | 'no' | 'intro' | 'partial';

/** Who is asking. The owner, a person the owner placed in a tier, or someone unknown. */
export interface Principal {
  /** Set when a trusted person speaks in a shared thread and so acts at the lower tier shown. */
  cappedFrom?: Tier;
  displayName: string;
  /** Stable id, e.g. `owner`, `contact:<id>`, `stranger:<channel>:<address>`. */
  id: string;
  tier: Tier;
}

/** An exception the owner wrote in plain words ("Sam can book us dinner this week"). */
export interface Grant {
  capabilities: Capability[];
  createdAt: string;
  /** ISO timestamp. */
  expiresAt?: string;
  id: string;
  note?: string;
  scope?: {
    maxUsd?: number;
    window?: { from: string; to: string };
  };
  /** Principal id the grant applies to. */
  to: string;
}

export interface SpendPolicy {
  allowedMerchants: string[];
  askAbove: number;
  blockedMerchants: string[];
  /** Words that always need the owner's yes when they appear in a purchase, e.g. `flights`. */
  neverWithoutAsk: string[];
  perActionUsd: number;
  perDayUsd: number;
}

export interface Policy {
  grants: Grant[];
  spend: SpendPolicy;
  /** Overrides of the default tier table: tier → capability → permission. */
  tiers: Partial<Record<Tier, Partial<Record<Capability, Permission>>>>;
  version: 1;
}

export type PolicyDecision =
  | { outcome: 'allow'; reason: string; viaGrant?: string }
  | { approvalPrompt: string; outcome: 'ask'; reason: string }
  | { outcome: 'deny'; reason: string };

/** The intrinsic side effect of a tool: reading, changing something, or something hard to undo. */
export type ToolClass = 'read' | 'write' | 'sensitive';

/** How much of one connector an agent may use. Least access by default. */
export type GrantLevel = 'none' | 'read' | 'read_write';

/** What the policy needs to know about the tool being called. */
export interface PolicyTool {
  /** Extracts the USD amount for spend checks, when the tool spends money. */
  amountUsd?: (args: Record<string, unknown>) => number | undefined;
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
  /** Capabilities checked against the asker's tier. Tools that only act for the owner need none. */
  capabilities?: Capability[];
  /** The connector (MCP server, builtin tool set) the tool belongs to. */
  connectorId: string;
  /** Short human description for the approval card and the audit log. */
  describe?: (args: Record<string, unknown>) => string;
  name: string;
}
