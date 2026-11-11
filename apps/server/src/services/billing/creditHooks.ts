import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { AgentRuntimeError, type ModelRuntimeHooks } from '@lobechat/model-runtime';
import { ChatErrorType, type ModelUsage, Plans } from '@lobechat/types';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';

import { BillingService } from './index';

const log = debug('lobe-server:billing:credits');

/** A call's cost in credits, rounded up so many cheap calls cannot add up to nothing. */
export const creditsForUsage = (usage: ModelUsage | undefined): number | undefined =>
  usage?.cost === undefined ? undefined : Math.ceil(usage.cost * CREDITS_PER_DOLLAR);

/**
 * Meters a user's model calls that the platform pays for (no key of their own) against the
 * monthly credits of their plan: a call is refused once the month's credits are used up, and
 * each finished call is charged its actual cost. A call already running when the allowance runs
 * out finishes and is charged, so the total can end slightly above the allowance.
 */
export const createCreditHooks = (userId: string, provider: string): ModelRuntimeHooks => {
  const billing = async () => new BillingService(await getServerDB(), userId);

  const requireCredits = async () => {
    const allowance = await (await billing()).getAllowance();
    if (allowance.remainingCredits > 0) return;

    log(
      'refusing a call for %s: %d of %d credits used',
      userId,
      allowance.usedCredits,
      allowance.monthlyCredits,
    );
    throw AgentRuntimeError.chat({
      budget: { planAtError: allowance.plan, pricingBasis: 'exact', shortfallCredits: 0 },
      error: {
        message: `This month's credits of the ${allowance.plan} plan are used up; they renew on ${allowance.period.end.toISOString()}.`,
      },
      errorType:
        allowance.plan === Plans.Free
          ? ChatErrorType.FreePlanLimit
          : ChatErrorType.SubscriptionPlanLimit,
      provider,
    });
  };

  const charge = async (usage: ModelUsage | undefined, model?: string) => {
    const credits = creditsForUsage(usage);
    if (credits === undefined) {
      // console (not debug): a platform-paid call went uncharged because its model has no price
      if (usage)
        console.warn(`[billing] no cost for ${provider}/${model}; the call was not charged`);
      return;
    }

    try {
      await (await billing()).chargeCredits(credits);
    } catch (error) {
      // The reply already reached the user; a lost charge must not turn it into an error
      console.error(`[billing] charging ${credits} credits to ${userId} failed:`, error);
    }
  };

  return {
    beforeChat: requireCredits,
    beforeEmbeddings: requireCredits,
    beforeGenerateObject: requireCredits,
    onChatFinal: (data, { payload }) => charge(data.usage, payload.model),
    onEmbeddingsFinal: (data, { payload }) => charge(data.usage, payload.model),
    onGenerateObjectFinal: (data, { payload }) => charge(data.usage, payload.model),
  };
};
