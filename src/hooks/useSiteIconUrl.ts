import { useCallback } from 'react';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/**
 * Site icons come from DuckDuckGo, which learns every domain asked for: the sites a conversation
 * links to, searches or cites. Only the Global edition uses it; elsewhere there is no icon.
 */
export const useSiteIconUrl = () => {
  const isGlobalEdition = useServerConfigStore(serverConfigSelectors.isGlobalEdition);

  return useCallback(
    (host?: string) =>
      isGlobalEdition && host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : undefined,
    [isGlobalEdition],
  );
};
