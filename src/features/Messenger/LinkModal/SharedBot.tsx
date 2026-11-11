'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, QRCode, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MessengerPlatform, PlatformAvatar } from '../constants';

const styles = createStaticStyles(({ css, cssVar }) => ({
  qrIconOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    border: 3px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    line-height: 0;
  `,
  qrWrap: css`
    position: relative;

    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface SharedBotLinkBodyProps {
  /** Opens a chat with the bot; absent when the deployment has not configured it. */
  deepLink?: string;
  disabled?: boolean;
  /** Brand-name label (e.g. `"Telegram"`) sourced from the registry. */
  name: string;
  /** A line under the hint, e.g. the iMessage number to text. */
  note?: string;
  platform: MessengerPlatform;
  /** A second way forward under the main button, e.g. installing the Lark app first. */
  secondaryAction?: { href: string; label: string };
}

/**
 * Starts the link by messaging the bot (Telegram, the iMessage line, the Lark app): its reply
 * carries the link that connects the account. A QR code lets the user start on their phone.
 */
const SharedBotLinkBody = memo<SharedBotLinkBodyProps>(
  ({ deepLink, disabled, name, note, platform, secondaryAction }) => {
    const { t } = useTranslation('messenger');

    if (!deepLink) {
      return (
        <>
          <Icon icon={LinkIcon} size={36} />
          <Text strong>{t('messenger.linkModal.continueIn', { platform: name })}</Text>
          <Text type="warning">{t('messenger.linkModal.notConfigured')}</Text>
        </>
      );
    }

    return (
      <>
        <div className={styles.qrWrap}>
          <QRCode bordered={false} size={200} value={deepLink} />
          <div className={styles.qrIconOverlay}>
            <PlatformAvatar platform={platform} size={44} />
          </div>
        </div>
        <Flexbox align="center" gap={6}>
          <Text strong style={{ fontSize: 18 }}>
            {t('messenger.linkModal.continueIn', { platform: name })}
          </Text>
          <Text style={{ textAlign: 'center' }} type="secondary">
            {t('messenger.linkModal.scanHint', { platform: name })}
          </Text>
          {note && <Text strong>{note}</Text>}
        </Flexbox>
        <Button
          block
          disabled={disabled}
          href={disabled ? undefined : deepLink}
          size="large"
          target="_blank"
          type="primary"
        >
          {t('messenger.linkModal.openCta', { platform: name })}
        </Button>
        {secondaryAction && (
          <Button block href={secondaryAction.href} size="large" target="_blank">
            {secondaryAction.label}
          </Button>
        )}
      </>
    );
  },
);

SharedBotLinkBody.displayName = 'MessengerSharedBotLinkBody';

export default SharedBotLinkBody;
