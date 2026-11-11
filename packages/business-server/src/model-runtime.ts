import type { ModelRuntimeHooks } from '@lobechat/model-runtime';

import { createCreditHooks } from '@/server/services/billing/creditHooks';
import { isStripeOffered } from '@/server/services/billing/stripe';

export interface BusinessModelRuntimeContext {
  /**
   * The call runs on the platform's provider key because the user set none of their own. Only
   * such calls count against the plan's credits; callers that cannot tell leave it unset.
   */
  platformPaid?: boolean;
}

export function getBusinessModelRuntimeHooks(
  userId: string,
  provider: string,
  _workspaceId?: string,
  context?: BusinessModelRuntimeContext,
): ModelRuntimeHooks | undefined {
  // Plans are only enforced where they can be bought
  if (!context?.platformPaid || !isStripeOffered()) return undefined;

  return createCreditHooks(userId, provider);
}
