'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { LinkIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { usePermission } from '@/hooks/usePermission';

import type { SharedBotPlatform } from '../constants';
import { createMessengerLinkModal } from '../LinkModal';
import {
  DetailLayout,
  IntegrationDetailSkeleton,
  styles,
  useLinkActions,
  useMessengerData,
  UserAgentConnection,
} from './shared';

interface SharedBotDetailProps {
  appId?: string;
  botUsername?: string;
  name: string;
  onBack: () => void;
  phoneNumber?: string;
  platform: SharedBotPlatform;
}

// Telegram and the iMessage line are shared bots with no install audit list,
// so each is a single global user link with a connect/disconnect toggle in the
// header.
const SharedBotDetail = memo<SharedBotDetailProps>(
  ({ appId, botUsername, name, onBack, phoneNumber, platform }) => {
    const { t } = useTranslation('messenger');
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');

    const data = useMessengerData(platform);
    const { handleSetActive, handleUnlink } = useLinkActions({
      installationsMutate: data.installationsMutate,
      linksMutate: data.linksMutate,
      name,
      platform,
    });

    if (data.error && data.isInitialLoading)
      return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;
    if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

    const { links } = data;
    const hasLinks = links.length > 0;
    const link = links[0];

    const handleOpenLink = () =>
      createMessengerLinkModal({ appId, botUsername, name, phoneNumber, platform });

    const headerAction = hasLinks ? (
      <Button
        danger
        disabled={!canEdit}
        icon={<Icon icon={Trash2Icon} />}
        onClick={() => {
          if (!canEdit) return;
          handleUnlink('');
        }}
      >
        {t('messenger.unlinkCta')}
      </Button>
    ) : (
      <Button
        disabled={!canCreate || !canEdit}
        icon={<Icon icon={LinkIcon} />}
        type="primary"
        onClick={handleOpenLink}
      >
        {t('messenger.linkCta')}
      </Button>
    );

    return (
      <DetailLayout
        hasConnections={hasLinks}
        headerAction={headerAction}
        name={name}
        platform={platform}
        onBack={onBack}
      >
        {link ? (
          <UserAgentConnection
            link={link}
            onSetActive={(agentId) => handleSetActive('', agentId)}
            onUnlink={() => handleUnlink('')}
          />
        ) : (
          <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>
        )}
      </DetailLayout>
    );
  },
);

SharedBotDetail.displayName = 'MessengerSharedBotDetail';

export default SharedBotDetail;
