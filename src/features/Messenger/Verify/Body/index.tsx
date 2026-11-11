'use client';

import { memo } from 'react';

import type { MessengerPlatform } from '../../constants';
import DiscordBody from './Discord';
import type { ExistingLink, PeekedToken, PlatformMeta } from './shared';
import SharedBotBody from './SharedBot';
import WorkspaceBody from './Workspace';

interface BodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platform: MessengerPlatform;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
  userAvatar?: string | null;
}

const Body = memo<BodyProps>(({ platform, ...rest }) => {
  switch (platform) {
    case 'slack':
    case 'lark': {
      return <WorkspaceBody {...rest} platform={platform} />;
    }
    case 'discord': {
      return <DiscordBody {...rest} />;
    }
    case 'telegram':
    case 'imessage': {
      return <SharedBotBody {...rest} platform={platform} />;
    }
  }
});

Body.displayName = 'MessengerVerifyBody';

export default Body;
