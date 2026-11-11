'use client';

import {
  type BillingInterval,
  isPrepaidProvider,
  monthlyCreditsFor,
  planRank,
  type PrepaidProvider,
} from '@lobechat/billing';
import { Plans } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { Alert, Button, Progress, Segmented, Spin } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import useSWR from 'swr';

import { subscriptionService } from '@/services/subscription';

import { formatCredits, formatPlanPrice } from './format';
import PrepaidCheckout, { usePaidOrder } from './PrepaidCheckout';

const PAID_PLANS = [Plans.Starter, Plans.Premium, Plans.Ultimate] as const;

const PLAN_TITLE_KEYS = {
  [Plans.Free]: 'plans.plan.free.title',
  [Plans.Hobby]: 'plans.plan.hobby.title',
  [Plans.Premium]: 'plans.plan.premium.title',
  [Plans.Starter]: 'plans.plan.starter.title',
  [Plans.Ultimate]: 'plans.plan.ultimate.title',
} as const satisfies Record<Plans, string>;

const STATUS_KEY = 'billing:status';
const PRICES_KEY = 'billing:prices';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    flex: 1 1 220px;
    min-width: 220px;
  `,
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  planName: css`
    font-size: 20px;
    font-weight: 600;
  `,
  price: css`
    font-size: 18px;
    font-weight: 600;
  `,
}));

/** The signed-in user's plan, this month's credits, and the plans they can buy or switch to. */
const BillingPlans = memo(() => {
  const { i18n, t } = useTranslation('subscription');
  const [searchParams] = useSearchParams();
  const returnedFromCheckout = searchParams.get('checkout') === 'success';
  /** Set when Alipay's cashier sends the user back after paying */
  const returnedOrderId = searchParams.get('order') ?? undefined;

  const { data: status, error, mutate } = useSWR(STATUS_KEY, subscriptionService.getStatus);
  const { data: prices } = useSWR(PRICES_KEY, subscriptionService.getPrices);
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [opening, setOpening] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [buying, setBuying] = useState<(typeof PAID_PLANS)[number]>();
  const { data: returnedOrder } = usePaidOrder(returnedOrderId);
  const returnedOrderPaid = returnedOrder?.status === 'paid';

  useEffect(() => {
    if (returnedOrderPaid) mutate();
  }, [returnedOrderPaid, mutate]);

  useEffect(() => {
    // Stripe's webhook may still be on its way: read the new plan from Stripe now
    if (!returnedFromCheckout) return;
    subscriptionService
      .refresh()
      .then((fresh) => mutate(fresh, { revalidate: false }))
      .catch(() => mutate());
  }, [returnedFromCheckout, mutate]);

  const formatDate = (date: Date | string | null | undefined) =>
    date ? new Date(date).toLocaleDateString(i18n.language) : '';

  /** Leaves for a Stripe page; on failure the user stays here with a message. */
  const openStripe = async (
    key: string,
    open: () => Promise<{ url: string }>,
    errorKey: string,
  ) => {
    setOpening(key);
    setActionError(undefined);
    try {
      const { url } = await open();
      window.location.assign(url);
    } catch {
      setActionError(t(errorKey as 'planPage.checkoutError'));
      setOpening(undefined);
    }
  };

  if (!status) {
    return error ? (
      <Alert
        title={t('planPage.loadError')}
        type={'error'}
        action={
          <Button size={'small'} onClick={() => mutate()}>
            {t('planPage.retry')}
          </Button>
        }
      />
    ) : (
      <Flexbox align={'center'} padding={48}>
        <Spin />
      </Flexbox>
    );
  }

  const { credits, subscription } = status;
  const prepaidMethods = (['wechat', 'alipay'] as PrepaidProvider[]).filter(
    (method) => status[method].available,
  );
  const sellsPrepaid = prepaidMethods.length > 0;
  const prepaid = !!subscription && isPrepaidProvider(subscription.provider);
  const priceOf = (plan: Plans) => {
    const price = prices?.find((p) => p.plan === plan && p.interval === interval);
    return price && formatPlanPrice(price.unitAmount, price.currency, i18n.language);
  };
  const usedPercent =
    credits.monthly > 0 ? Math.min(100, (credits.used / credits.monthly) * 100) : 100;
  const openPortal = () =>
    openStripe('portal', subscriptionService.createPortal, 'planPage.portalError');

  return (
    <Flexbox gap={16} style={{ maxWidth: 1024, width: '100%' }}>
      {returnedFromCheckout && <Alert title={t('planPage.checkoutSuccess')} type={'success'} />}
      {returnedOrderId &&
        (returnedOrderPaid ? (
          <Alert title={t('planPage.checkoutSuccess')} type={'success'} />
        ) : (
          <Alert title={t('planPage.pay.confirming')} type={'info'} />
        ))}
      {subscription?.status === 'past_due' && (
        <Alert title={t('planPage.pastDue')} type={'warning'} />
      )}
      {actionError && <Alert title={actionError} type={'error'} />}

      <Block gap={12} padding={16} variant={'filled'}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox gap={4}>
            <span className={styles.muted}>{t('currentPlan.title')}</span>
            <span className={styles.planName}>{t(PLAN_TITLE_KEYS[status.plan])}</span>
            {subscription && (
              <span className={styles.muted}>
                {prepaid
                  ? t('planPage.paidThrough', { date: formatDate(subscription.currentPeriodEnd) })
                  : subscription.cancelAtPeriodEnd
                    ? t('planPage.endsOn', { date: formatDate(subscription.currentPeriodEnd) })
                    : t('planPage.renewsOn', { date: formatDate(subscription.currentPeriodEnd) })}
              </span>
            )}
          </Flexbox>
          {status.stripe.hasCustomer && (
            <Button loading={opening === 'portal'} onClick={openPortal}>
              {t('currentPlan.management')}
            </Button>
          )}
        </Flexbox>
        <Progress percent={usedPercent} showInfo={false} />
        <Flexbox horizontal gap={8} justify={'space-between'} wrap={'wrap'}>
          <span>
            {t('planPage.creditsUsed', {
              total: formatCredits(credits.monthly),
              used: formatCredits(credits.used),
            })}
          </span>
          <span className={styles.muted}>
            {t('planPage.creditsReset', { date: formatDate(credits.periodEnd) })}
          </span>
        </Flexbox>
        <span className={styles.muted}>{t('planPage.ownKeyNote')}</span>
      </Block>

      {(status.stripe.available || sellsPrepaid) && (
        <>
          <Segmented
            value={interval}
            options={[
              { label: t('planPage.monthly'), value: 'monthly' },
              { label: t('planPage.yearly'), value: 'yearly' },
            ]}
            onChange={(value) => setInterval(value as BillingInterval)}
          />
          <Flexbox horizontal gap={12} wrap={'wrap'}>
            {PAID_PLANS.map((plan) => {
              const price = priceOf(plan);
              const isCurrent = status.plan === plan;

              return (
                <Block className={styles.card} gap={8} key={plan} padding={16} variant={'outlined'}>
                  <span className={styles.planName}>{t(PLAN_TITLE_KEYS[plan])}</span>
                  {price && (
                    <span className={styles.price}>
                      {t(interval === 'monthly' ? 'planPage.perMonth' : 'planPage.perYear', {
                        price,
                      })}
                    </span>
                  )}
                  <span className={styles.muted}>
                    {t('planPage.monthlyCredits', {
                      credits: formatCredits(monthlyCreditsFor(plan)),
                    })}
                  </span>
                  {sellsPrepaid ? (
                    subscription && !prepaid ? (
                      // An App Store subscription renews by itself; it is changed in the App Store
                      <Button block disabled>
                        {isCurrent ? t('planPage.current') : t('planPage.managedElsewhere')}
                      </Button>
                    ) : prepaid && planRank(plan) < planRank(status.plan) ? (
                      <Button block disabled>
                        {t('planPage.lowerPlanLater')}
                      </Button>
                    ) : (
                      <Button
                        block
                        type={isCurrent ? 'default' : 'primary'}
                        onClick={() => setBuying(plan)}
                      >
                        {isCurrent ? t('planPage.extend') : t('plans.changePlan')}
                      </Button>
                    )
                  ) : isCurrent ? (
                    <Button block disabled>
                      {t('planPage.current')}
                    </Button>
                  ) : subscription ? (
                    // Switching plans prorates the running subscription, which Stripe's portal does
                    <Button block loading={opening === 'portal'} onClick={openPortal}>
                      {t('planPage.changePlan')}
                    </Button>
                  ) : (
                    <Button
                      block
                      loading={opening === plan}
                      type={'primary'}
                      onClick={() =>
                        openStripe(
                          plan,
                          () => subscriptionService.createCheckout({ interval, plan }),
                          'planPage.checkoutError',
                        )
                      }
                    >
                      {t('plans.changePlan')}
                    </Button>
                  )}
                </Block>
              );
            })}
          </Flexbox>
        </>
      )}

      {buying && (
        <PrepaidCheckout
          interval={interval}
          methods={prepaidMethods}
          plan={buying}
          planTitle={t(PLAN_TITLE_KEYS[buying])}
          price={priceOf(buying) ?? ''}
          onClose={() => setBuying(undefined)}
          onPaid={() => mutate()}
        />
      )}
    </Flexbox>
  );
});

export default BillingPlans;
