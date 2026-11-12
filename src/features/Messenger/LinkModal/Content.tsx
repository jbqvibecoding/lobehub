'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildImessageUrl,
  buildLarkOpenBotUrl,
  buildTelegramDeepLink,
  type MessengerPlatform,
} from '../constants';
import DiscordLinkBody from './Discord';
import SharedBotLinkBody from './SharedBot';
import SlackLinkBody from './Slack';

export interface LinkModalContentProps {
  appId?: string;
  botUsername?: string;
  /** Lark: the App Directory listing where a workspace admin installs the app. */
  installUrl?: string;
  name: string;
  phoneNumber?: string;
  platform: MessengerPlatform;
  /** WeChat: what the Official Account's follow QR code encodes. */
  qrCodeUrl?: string;
}

const LinkModalContent = memo<LinkModalContentProps>(
  ({ appId, botUsername, installUrl, name, phoneNumber, platform, qrCodeUrl }) => {
    const { t } = useTranslation('messenger');

    const renderBody = () => {
      switch (platform) {
        case 'slack': {
          return <SlackLinkBody />;
        }
        case 'discord': {
          return <DiscordLinkBody appId={appId} name={name} />;
        }
        case 'telegram': {
          return (
            <SharedBotLinkBody
              deepLink={botUsername ? buildTelegramDeepLink(botUsername) : undefined}
              name={name}
              platform="telegram"
            />
          );
        }
        case 'lark':
        case 'feishu': {
          return (
            <SharedBotLinkBody
              deepLink={appId ? buildLarkOpenBotUrl(appId, platform) : undefined}
              name={name}
              note={t('messenger.linkModal.larkInstallNote', { platform: name })}
              platform={platform}
              secondaryAction={
                installUrl
                  ? {
                      href: installUrl,
                      label: t('messenger.linkModal.installCta', { platform: name }),
                    }
                  : undefined
              }
            />
          );
        }
        case 'imessage': {
          return (
            <SharedBotLinkBody
              deepLink={phoneNumber ? buildImessageUrl(phoneNumber) : undefined}
              name={name}
              note={phoneNumber && t('messenger.linkModal.textNumber', { number: phoneNumber })}
              platform="imessage"
            />
          );
        }
        case 'wechat': {
          // An Official Account is found by scanning its code in WeChat, not by opening a link
          return (
            <SharedBotLinkBody
              scanOnly
              deepLink={qrCodeUrl}
              name={name}
              note={t('messenger.linkModal.wechatFollowNote')}
              platform="wechat"
            />
          );
        }
      }
    };

    return (
      <Flexbox align={'center'} gap={20} style={{ paddingBlockEnd: 16, paddingBlockStart: 24 }}>
        {renderBody()}
      </Flexbox>
    );
  },
);

LinkModalContent.displayName = 'MessengerLinkModalContent';

export default LinkModalContent;
