'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { usePermission } from '@/hooks/usePermission';

import type { LarkFamilyPlatform } from '../constants';
import { createMessengerLinkModal } from '../LinkModal';
import {
  DetailLayout,
  IntegrationDetailSkeleton,
  styles,
  useLinkActions,
  useMessengerData,
  UserAgentConnection,
} from './shared';

interface LarkDetailProps {
  appId?: string;
  installUrl?: string;
  name: string;
  onBack: () => void;
  platform: LarkFamilyPlatform;
}

// Lark and Feishu workspaces install the app from the Lark App Directory, not from here, so there are no
// install rows to manage: a person links their account once per workspace by messaging the app.
const LarkDetail = memo<LarkDetailProps>(({ appId, installUrl, name, onBack, platform }) => {
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

  const headerAction = (
    <Button
      disabled={!canCreate || !canEdit}
      icon={<Icon icon={LinkIcon} />}
      type={hasLinks ? 'default' : 'primary'}
      onClick={() => createMessengerLinkModal({ appId, installUrl, name, platform })}
    >
      {hasLinks ? t('messenger.detail.addWorkspace') : t('messenger.linkCta')}
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
      {links.map((link) => (
        <UserAgentConnection
          // Only worth telling workspaces apart when there is more than one.
          extraLabel={links.length > 1 ? link.tenantId : undefined}
          key={link.id}
          link={link}
          onSetActive={(agentId) => handleSetActive(link.tenantId, agentId)}
          onUnlink={() => handleUnlink(link.tenantId)}
        />
      ))}
      {!hasLinks && (
        <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>
      )}
    </DetailLayout>
  );
});

LarkDetail.displayName = 'MessengerLarkDetail';

export default LarkDetail;
