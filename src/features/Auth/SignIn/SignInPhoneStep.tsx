import { Flexbox } from '@lobehub/ui';
import { Button, Input, Text } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AuthCard from '@/features/AuthCard';
import { AuthAgreement } from '@/features/AuthShell';
import { phoneNumber } from '@/libs/better-auth/auth-client';
import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

import { normalizeMainlandMobile } from './phone';

const RESEND_AFTER_SECONDS = 60;

/**
 * Sign in, or sign up, with a code texted to a mainland China mobile number (mainland edition).
 * A number without an account gets one once the code is confirmed.
 */
export const SignInPhoneStep = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const sendCode = async () => {
    const number = normalizeMainlandMobile(input);
    if (!number) {
      setError(t('betterAuth.signin.phone.invalid'));
      return;
    }
    setError(undefined);
    setBusy(true);
    const { error: sendError } = await phoneNumber.sendOtp({ phoneNumber: number });
    setBusy(false);
    if (sendError) {
      setError(t('betterAuth.signin.phone.sendFailed'));
      return;
    }
    setSentTo(number);
    setWait(RESEND_AFTER_SECONDS);
  };

  const verify = async () => {
    if (!sentTo) return;
    setError(undefined);
    setBusy(true);
    const { error: verifyError } = await phoneNumber.verify({
      code: code.trim(),
      phoneNumber: sentTo,
    });
    setBusy(false);
    if (verifyError) {
      setError(t('betterAuth.signin.phone.wrongCode'));
      return;
    }
    // The callback page belongs to the main app, outside this auth SPA: load it fully
    window.location.href = sanitizeRedirectPath(searchParams.get('callbackUrl') || '/');
  };

  return (
    <AuthCard
      subtitle={t('betterAuth.signin.phone.subtitle')}
      title={t('betterAuth.signin.phone.title')}
      footer={
        <Text align={'center'} fontSize={13} style={{ marginTop: 16 }} type={'secondary'}>
          <a
            role="button"
            style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            tabIndex={0}
            onClick={onBack}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onBack();
              }
            }}
          >
            {t('betterAuth.signin.phone.back')}
          </a>
        </Text>
      }
    >
      <Flexbox gap={12}>
        <Flexbox horizontal gap={8}>
          <Input
            aria-label={t('betterAuth.signin.phone.placeholder')}
            autoComplete="tel"
            inputMode="tel"
            placeholder={t('betterAuth.signin.phone.placeholder')}
            prefix="+86"
            size="large"
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => !sentTo && sendCode()}
          />
          <Button disabled={busy || wait > 0} size="large" onClick={sendCode}>
            {wait > 0
              ? t('betterAuth.signin.phone.resendIn', { seconds: wait })
              : t('betterAuth.signin.phone.sendCode')}
          </Button>
        </Flexbox>
        {sentTo && (
          <Input
            aria-label={t('betterAuth.signin.phone.codePlaceholder')}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            placeholder={t('betterAuth.signin.phone.codePlaceholder')}
            size="large"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onPressEnter={verify}
          />
        )}
        {error && (
          <Text role="alert" type={'danger'}>
            {error}
          </Text>
        )}
        <Button
          block
          disabled={!sentTo || code.trim().length !== 6}
          loading={busy && !!sentTo}
          size="large"
          type="primary"
          onClick={verify}
        >
          {t('betterAuth.signin.phone.signIn')}
        </Button>
        <AuthAgreement />
      </Flexbox>
    </AuthCard>
  );
};
