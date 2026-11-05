/**
 * The default trust table, copied from Open Instinct (`packages/core/src/policy.ts`, MIT).
 * Each row is one capability; columns follow TIER_ORDER: owner, partner, family, friend, contact,
 * stranger.
 *
 * `web.read` and `apps.use` are transport capabilities: the specific capability on the same tool
 * (calendar.freebusy, email.send, ...) does the real gating, so they are open to everyone the
 * owner placed in a tier and closed to contacts and strangers.
 */
import type { Capability, Permission, Policy, SpendPolicy, Tier } from './types';
import { TIER_ORDER } from './types';

type Row = [
  owner: Permission,
  partner: Permission,
  family: Permission,
  friend: Permission,
  contact: Permission,
  stranger: Permission,
];

const ROWS: Record<Capability, Row> = {
  'converse': ['yes', 'yes', 'yes', 'yes', 'yes', 'intro'],
  'owner.relay': ['yes', 'yes', 'yes', 'yes', 'yes', 'yes'],
  'owner.profile.public': ['yes', 'yes', 'yes', 'yes', 'yes', 'no'],
  'owner.profile.preferences': ['yes', 'yes', 'partial', 'partial', 'no', 'no'],
  'owner.location.exact': ['yes', 'yes', 'no', 'no', 'no', 'no'],
  'owner.location.approx': ['yes', 'yes', 'yes', 'no', 'no', 'no'],
  'calendar.freebusy': ['yes', 'yes', 'yes', 'yes', 'no', 'no'],
  'calendar.read': ['yes', 'yes', 'no', 'no', 'no', 'no'],
  'calendar.write': ['yes', 'ask', 'ask', 'no', 'no', 'no'],
  'email.read': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'email.send': ['yes', 'ask', 'no', 'no', 'no', 'no'],
  'contacts.read': ['yes', 'partial', 'no', 'no', 'no', 'no'],
  'plans.propose': ['yes', 'yes', 'yes', 'yes', 'no', 'no'],
  'plans.commit': ['yes', 'ask', 'ask', 'ask', 'no', 'no'],
  'purchase': ['limit', 'ask', 'no', 'no', 'no', 'no'],
  'travel.book': ['limit', 'ask', 'no', 'no', 'no', 'no'],
  'computer.use': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'files.read': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'files.write': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'memory.write': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'network.ask': ['yes', 'yes', 'yes', 'yes', 'no', 'no'],
  'network.invite': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'trust.manage': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'schedule.manage': ['yes', 'no', 'no', 'no', 'no', 'no'],
  'web.read': ['yes', 'yes', 'yes', 'yes', 'no', 'no'],
  'apps.use': ['yes', 'yes', 'yes', 'yes', 'no', 'no'],
};

/** Capabilities that move money. The owner gets them under the spend policy; a grant never skips it. */
export const SPEND_CAPABILITIES: ReadonlySet<Capability> = new Set(['purchase', 'travel.book']);

export const ALL_CAPABILITIES = Object.keys(ROWS) as Capability[];

export const DEFAULT_TIER_TABLE = Object.fromEntries(
  TIER_ORDER.map((tier, column) => [
    tier,
    Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => [capability, ROWS[capability][column]]),
    ),
  ]),
) as Record<Tier, Record<Capability, Permission>>;

export const defaultSpendPolicy = (): SpendPolicy => ({
  allowedMerchants: [],
  askAbove: 50,
  blockedMerchants: [],
  neverWithoutAsk: ['flights', 'hotels'],
  perActionUsd: 100,
  perDayUsd: 300,
});

export const defaultPolicy = (): Policy => ({
  grants: [],
  spend: defaultSpendPolicy(),
  tiers: {},
  version: 1,
});
