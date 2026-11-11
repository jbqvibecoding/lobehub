import { lambdaClient } from '@/libs/trpc/client';

type CheckoutParams = Parameters<typeof lambdaClient.subscription.createCheckout.mutate>[0];
type PrepaidOrderParams = Parameters<typeof lambdaClient.subscription.createPrepaidOrder.mutate>[0];

class SubscriptionService {
  getStatus = async () => lambdaClient.subscription.status.query();

  getPrices = async () => lambdaClient.subscription.prices.query();

  createCheckout = async (params: CheckoutParams) =>
    lambdaClient.subscription.createCheckout.mutate(params);

  createPortal = async () => lambdaClient.subscription.createPortal.mutate();

  /** Mainland edition: pays for a prepaid period with WeChat Pay or Alipay. */
  createPrepaidOrder = async (params: PrepaidOrderParams) =>
    lambdaClient.subscription.createPrepaidOrder.mutate(params);

  getPrepaidOrder = async (orderId: string) =>
    lambdaClient.subscription.prepaidOrder.query({ orderId });

  refresh = async () => lambdaClient.subscription.refresh.mutate();
}

export const subscriptionService = new SubscriptionService();
