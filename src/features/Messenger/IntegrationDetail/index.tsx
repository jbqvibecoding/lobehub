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
}

const IntegrationDetail = memo<IntegrationDetailProps>(
  ({ installUrl, phoneNumber, platform, ...rest }) => {
    switch (platform) {
      case 'slack': {
        return <SlackDetail {...rest} />;
      }
      case 'discord': {
        return <DiscordDetail {...rest} />;
      }
      case 'telegram':
      case 'imessage': {
        return <SharedBotDetail {...rest} phoneNumber={phoneNumber} platform={platform} />;
      }
      case 'lark': {
        return <LarkDetail {...rest} installUrl={installUrl} />;
      }
    }
  },
);

IntegrationDetail.displayName = 'MessengerIntegrationDetail';

export default IntegrationDetail;
