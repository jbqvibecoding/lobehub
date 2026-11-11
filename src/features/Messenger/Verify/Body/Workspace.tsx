'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildLarkOpenBotUrl,
  buildSlackOpenBotUrl,
  type WorkspaceBotPlatform,
} from '../../constants';
import {
  ConfirmCard,
  type ExistingLink,
  type InfoRow,
  type PeekedToken,
  type PlatformMeta,
  SuccessCard,
} from './shared';
import { isSingleAccountRebindBlocked, shouldShowSingleAccountSuccess } from './singleAccountState';

interface WorkspaceBodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platform: WorkspaceBotPlatform;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
  userAvatar?: string | null;
}

const openBotUrl = (
  platform: WorkspaceBotPlatform,
  tenantId: string | undefined,
  appId: string | undefined,
): string | null => {
  if (platform === 'lark') return appId ? buildLarkOpenBotUrl(appId) : null;
  return tenantId ? buildSlackOpenBotUrl(tenantId, appId) : null;
};

/** A bot installed per workspace (Slack, Lark): the link names the workspace it belongs to. */
const WorkspaceBody = memo<WorkspaceBodyProps>(
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

    const platformLabel = platformMeta?.name ?? (platform === 'lark' ? 'Lark' : 'Slack');
    const rebindBlocked = isSingleAccountRebindBlocked(existingLink, tokenData);
    // Slack uses tenant from the existing link (post-confirm/refresh) or the
    // pending token (pre-confirm). Without a tenant, the workspace deep-link
    // can't be built, so the success state hides the CTA.
    const tenantId = existingLink?.tenantId ?? tokenData?.tenantId ?? undefined;

    if (shouldShowSingleAccountSuccess(existingLink, tokenData, done)) {
      return (
        <SuccessCard
          openBotUrl={openBotUrl(platform, tenantId, platformMeta?.appId)}
          platformLabel={platformLabel}
        />
      );
    }

    if (!tokenData) return null;

    const handle = tokenData.platformUsername ?? `ID ${tokenData.platformUserId}`;
    const infoRows: InfoRow[] = [
      { label: t('verify.confirm.fields.lobeHubAccount'), value: lobeAccount },
      {
        label: t('verify.confirm.fields.platformAccount', { platform: platformLabel }),
        value: handle,
      },
    ];
    if (tokenData.tenantName) {
      infoRows.push({ label: t('verify.confirm.fields.workspace'), value: tokenData.tenantName });
    }

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
                  account:
                    existingLink?.platformUsername ?? `ID ${existingLink?.platformUserId ?? ''}`,
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
WorkspaceBody.displayName = 'MessengerVerifyWorkspaceBody';

export default WorkspaceBody;
