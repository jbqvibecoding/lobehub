'use client';

import { memo } from 'react';

import type { MessengerPlatform } from '../constants';
import DiscordDetail from './Discord';
import LarkDetail from './Lark';
import SharedBotDetail from './SharedBot';
import SlackDetail from './Slack';

interface IntegrationDetailProps {
  appId?: string;
  botUsername?: string;
  /** Lark: the App Directory listing where a workspace admin installs the app. */
  installUrl?: string;
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
  onBack: () => void;
  /** The iMessage line's number. */
  phoneNumber?: string;
  platform: MessengerPlatform;
  /** WeChat: what the Official Account's follow QR code encodes. */
  qrCodeUrl?: string;
}

const IntegrationDetail = memo<IntegrationDetailProps>(
  ({ installUrl, phoneNumber, platform, qrCodeUrl, ...rest }) => {
    switch (platform) {
      case 'slack': {
        return <SlackDetail {...rest} />;
      }
      case 'discord': {
        return <DiscordDetail {...rest} />;
      }
      case 'telegram':
      case 'imessage':
      case 'wechat': {
        return (
          <SharedBotDetail
            {...rest}
            phoneNumber={phoneNumber}
            platform={platform}
            qrCodeUrl={qrCodeUrl}
          />
        );
      }
      case 'lark':
      case 'feishu': {
        return <LarkDetail {...rest} installUrl={installUrl} platform={platform} />;
      }
    }
  },
);

IntegrationDetail.displayName = 'MessengerIntegrationDetail';

export default IntegrationDetail;
