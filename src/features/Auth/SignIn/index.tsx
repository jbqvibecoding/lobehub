'use client';

import { Text } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { SignInEmailSentStep } from './SignInEmailSentStep';
import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { SignInPhoneStep } from './SignInPhoneStep';
import { useSignIn } from './useSignIn';

const SignIn = () => {
  const {
    disableEmailPassword,
    email,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToSignup,
    handleResendEmail,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    sending,
    sentInfo,
    serverConfigInit,
    socialLoading,
    step,
  } = useSignIn();
  const { t } = useTranslation('auth');
  const enablePhoneSignIn = useServerConfigStore(serverConfigSelectors.enablePhoneSignIn);
  const [withPhone, setWithPhone] = useState(false);

  if (withPhone) return <SignInPhoneStep onBack={() => setWithPhone(false)} />;

  if (step === 'emailSent' && sentInfo)
    return (
      <SignInEmailSentStep
        email={sentInfo.email}
        sending={sending}
        type={sentInfo.type}
        onBack={handleBackFromSent}
        onResend={handleResendEmail}
      />
    );

  if (step === 'password')
    return (
      <SignInPasswordStep
        email={email}
        forgotLoading={sending}
        form={form as any}
        loading={loading}
        onBackToEmail={handleBackToEmail}
        onForgotPassword={handleForgotPassword}
        onSubmit={handleSignIn}
      />
    );

  const emailStep = (
    <SignInEmailStep
      disableEmailPassword={disableEmailPassword}
      form={form as any}
      isSocialOnly={isSocialOnly}
      lastAuthProvider={lastAuthProvider}
      loading={loading}
      oAuthSSOProviders={oAuthSSOProviders}
      serverConfigInit={serverConfigInit}
      socialLoading={socialLoading}
      onCheckUser={handleCheckUser}
      onGoToSignup={handleGoToSignup}
      onResetEmail={handleBackToEmail}
      onSetPassword={handleForgotPassword}
      onSocialSignIn={handleSocialSignIn}
    />
  );
  if (!enablePhoneSignIn) return emailStep;

  // Mainland edition: phone numbers sign in too
  return (
    <>
      {emailStep}
      <Text align={'center'} fontSize={13} style={{ marginTop: 12 }}>
        <a
          role="button"
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          tabIndex={0}
          onClick={() => setWithPhone(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setWithPhone(true);
            }
          }}
        >
          {t('betterAuth.signin.phone.link')}
        </a>
      </Text>
    </>
  );
};

export default SignIn;
