'use client';

import type { BillingInterval, PrepaidProvider } from '@lobechat/billing';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Modal, QRCode, Segmented, Spin } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { subscriptionService } from '@/services/subscription';

const POLL_MS = 2000;

type PaidPlan = Parameters<typeof subscriptionService.createPrepaidOrder>[0]['plan'];

const styles = createStaticStyles(({ css, cssVar }) => ({
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  price: css`
    font-size: 24px;
    font-weight: 600;
  `,
}));

/** Follows an order until its provider confirms the payment. */
export const usePaidOrder = (orderId: string | undefined) =>
  useSWR(
    orderId ? ['billing:prepaid-order', orderId] : null,
    () => subscriptionService.getPrepaidOrder(orderId!),
    { refreshInterval: (order) => (order?.status === 'pending' || !order ? POLL_MS : 0) },
  );

interface PrepaidCheckoutProps {
  interval: BillingInterval;
  methods: PrepaidProvider[];
  onClose: () => void;
  onPaid: () => void;
  plan: PaidPlan;
  planTitle: string;
  price: string;
}

/**
 * Pays for a prepaid period (mainland edition). WeChat Pay shows a QR code here and waits for the
 * payment; Alipay leaves for its cashier page and comes back to the plans page.
 */
const PrepaidCheckout = memo<PrepaidCheckoutProps>(
  ({ interval, methods, onClose, onPaid, plan, planTitle, price }) => {
    const { t } = useTranslation('subscription');
    const [method, setMethod] = useState<PrepaidProvider>(methods[0]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const [wechat, setWechat] = useState<{ codeUrl: string; orderId: string }>();
    const { data: order } = usePaidOrder(wechat?.orderId);
    const paid = order?.status === 'paid';

    const pay = async () => {
      setBusy(true);
      setError(undefined);
      try {
        const created = await subscriptionService.createPrepaidOrder({
          interval,
          plan,
          provider: method,
        });
        if (created.payUrl) {
          window.location.assign(created.payUrl);
          return;
        }
        if (created.codeUrl) setWechat({ codeUrl: created.codeUrl, orderId: created.orderId });
      } catch (cause) {
        const code = (cause as { data?: { code?: string } })?.data?.code;
        setError(t(code === 'CONFLICT' ? 'planPage.pay.conflict' : 'planPage.pay.error'));
      }
      setBusy(false);
    };

    const close = () => {
      if (paid) onPaid();
      onClose();
    };

    return (
      <Modal
        open
        footer={null}
        title={t('planPage.pay.title', { plan: planTitle })}
        width={400}
        onCancel={close}
      >
        <Flexbox align={'center'} gap={16} paddingBlock={8}>
          <span className={styles.price}>{price}</span>

          {paid ? (
            <>
              <Alert title={t('planPage.checkoutSuccess')} type={'success'} />
              <Button block type={'primary'} onClick={close}>
                {t('planPage.pay.done')}
              </Button>
            </>
          ) : wechat ? (
            <>
              <QRCode bordered={false} size={200} value={wechat.codeUrl} />
              <span className={styles.muted}>{t('planPage.pay.scan')}</span>
              <Flexbox horizontal align={'center'} gap={8}>
                <Spin size={'small'} />
                <span className={styles.muted}>{t('planPage.pay.waiting')}</span>
              </Flexbox>
            </>
          ) : (
            <>
              {methods.length > 1 && (
                <Segmented
                  block
                  value={method}
                  options={methods.map((value) => ({
                    label: t(value === 'wechat' ? 'planPage.pay.wechat' : 'planPage.pay.alipay'),
                    value,
                  }))}
                  onChange={(value) => setMethod(value as PrepaidProvider)}
                />
              )}
              {error && <Alert title={error} type={'error'} />}
              <Button block loading={busy} size={'large'} type={'primary'} onClick={pay}>
                {t(method === 'wechat' ? 'planPage.pay.withWechat' : 'planPage.pay.withAlipay')}
              </Button>
              <span className={styles.muted}>{t('planPage.pay.prepaidNote')}</span>
            </>
          )}
        </Flexbox>
      </Modal>
    );
  },
);

export default PrepaidCheckout;
