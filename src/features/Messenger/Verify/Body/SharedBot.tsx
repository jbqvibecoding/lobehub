'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type SharedBotPlatform, sharedBotUrl } from '../../constants';
import {
  ConfirmCard,
  type ExistingLink,
  type InfoRow,
  type PeekedToken,
  type PlatformMeta,
  SuccessCard,
} from './shared';
import { isSingleAccountRebindBlocked, shouldShowSingleAccountSuccess } from './singleAccountState';

interface SharedBotBodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platform: SharedBotPlatform;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
  userAvatar?: string | null;
}

/** A shared bot (Telegram, the iMessage line) has one account per user and no workspace. */
const SharedBotBody = memo<SharedBotBodyProps>(
  ({
    existingLink,
    lobeAccount,
    platform,
    platformMeta,
    randomId,
    signInUrl,
    tokenData,
    userAvatar,
  }) => {
    const { t } = useTranslation('messenger');
    const [done, setDone] = useState(false);

    const platformLabel = platformMeta?.name ?? (platform === 'imessage' ? 'iMessage' : 'Telegram');
    // iMessage identifies people by their phone number or Apple ID email, which reads as-is.
    const describeAccount = (account: {
      platformUserId?: string;
      platformUsername?: string | null;
    }) =>
      account.platformUsername ??
      (platform === 'imessage'
        ? (account.platformUserId ?? '')
        : `ID ${account.platformUserId ?? ''}`);
    const rebindBlocked = isSingleAccountRebindBlocked(existingLink, tokenData);

    if (shouldShowSingleAccountSuccess(existingLink, tokenData, done)) {
      return (
        <SuccessCard
          openBotUrl={sharedBotUrl(platform, platformMeta ?? {})}
          platformLabel={platformLabel}
        />
      );
    }

    if (!tokenData) return null;

    // Shared bots have no workspace/tenant concept — skip the workspace row entirely.
    const handle = describeAccount(tokenData);
    const infoRows: InfoRow[] = [
      { label: t('verify.confirm.fields.lobeHubAccount'), value: lobeAccount },
      {
        label: t('verify.confirm.fields.platformAccount', { platform: platformLabel }),
        value: handle,
      },
    ];

    return (
      <ConfirmCard
        infoRows={infoRows}
        platform={platform}
        randomId={randomId}
        userAvatar={userAvatar}
        blockingNotice={
          rebindBlocked
            ? {
                ctaHref: `/settings/messenger/${platform}`,
                ctaLabel: t('verify.confirm.relink.manage'),
                description: t('verify.confirm.relink.description', {
                  account: existingLink ? describeAccount(existingLink) : '',
                  platform: platformLabel,
                }),
                title: t('verify.confirm.relink.title', { platform: platformLabel }),
              }
            : tokenData.linkedToEmail
              ? {
                  ctaHref: signInUrl,
                  ctaLabel: t('verify.confirm.conflict.switchAccount'),
                  description: t('verify.confirm.conflict.description', {
                    email: tokenData.linkedToEmail,
                    platform: platformLabel,
                  }),
                  title: t('verify.confirm.conflict.title'),
                }
              : undefined
        }
        onSuccess={() => setDone(true)}
      />
    );
  },
);
SharedBotBody.displayName = 'MessengerVerifySharedBotBody';

export default SharedBotBody;
