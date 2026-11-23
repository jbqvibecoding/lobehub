'use client';

import { useTranslation } from 'react-i18next';

import BillingPlans from '@/features/BillingPlans';
import SettingHeader from '@/features/Settings/features/SettingHeader';

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
