'use client';

import { memo } from 'react';

import type { MessengerPlatform } from '../constants';
import DiscordDetail from './Discord';
import SharedBotDetail from './SharedBot';
import SlackDetail from './Slack';

interface IntegrationDetailProps {
  appId?: string;
  botUsername?: string;
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
  onBack: () => void;
  /** The iMessage line's number. */
  phoneNumber?: string;
  platform: MessengerPlatform;
}

const IntegrationDetail = memo<IntegrationDetailProps>(({ phoneNumber, platform, ...rest }) => {
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
  }
});

IntegrationDetail.displayName = 'MessengerIntegrationDetail';

export default IntegrationDetail;
