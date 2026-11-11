/* eslint-disable unused-imports/no-unused-vars */
import type { Plans, ReferralStatusString } from '@lobechat/types';

import { getServerDB } from '@/database/core/db-adaptor';
import { BillingService } from '@/server/services/billing';

export interface OnUserActivityForBusinessParams {
  currentTime: Date;
  previousLastActiveAt: Date;
  userCreatedAt: Date;
  userId: string;
}

export async function getReferralStatus(userId: string): Promise<ReferralStatusString | undefined> {
  return undefined;
}

/** The plan the user's subscriptions currently grant; Free without one. */
export async function getSubscriptionPlan(userId: string): Promise<Plans> {
  return new BillingService(await getServerDB(), userId).getPlan();
}

export async function initNewUserForBusiness(
  userId: string,
  createdAt: Date | null | undefined,
): Promise<void> {}

export async function onUserActivityForBusiness(
  params: OnUserActivityForBusinessParams,
): Promise<void> {}
