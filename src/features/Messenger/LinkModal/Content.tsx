'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildImessageUrl, buildTelegramDeepLink, type MessengerPlatform } from '../constants';
import DiscordLinkBody from './Discord';
import SharedBotLinkBody from './SharedBot';
import SlackLinkBody from './Slack';

export interface LinkModalContentProps {
  appId?: string;
  botUsername?: string;
  name: string;
  phoneNumber?: string;
  platform: MessengerPlatform;
}

const LinkModalContent = memo<LinkModalContentProps>(
  ({ appId, botUsername, name, phoneNumber, platform }) => {
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
