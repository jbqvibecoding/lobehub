'use client';

import { useTranslation } from 'react-i18next';

import BillingPlans from '@/features/BillingPlans';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Plans = () => {
  const { t } = useTranslation('subscription');

  return (
    <>
      <SettingHeader title={t('tab.plans')} />
      <BillingPlans />
    </>
  );
};

export default Plans;
