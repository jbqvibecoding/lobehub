import { type MarkdownProps } from '@lobehub/ui';
import { Markdown } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { linkWithoutSiteIcons } from './linkWithoutSiteIcons';

const MarkdownMessage = memo<MarkdownProps>(({ children, componentProps, ...rest }) => {
  const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
    userGeneralSettingsSelectors.config,
  );
  const isGlobalEdition = useServerConfigStore(serverConfigSelectors.isGlobalEdition);

  const { citations, components, enableCustomFootnotes } = rest;
  // Citation hover cards and the source cards under a message load each source's icon from
  // DuckDuckGo, so only the Global edition keeps them. Elsewhere footnotes fall back to the plain
  // list, and model citations link straight to their source.
  const markdownComponents = useMemo(
    () =>
      isGlobalEdition
        ? components
        : ({ ...components, a: linkWithoutSiteIcons(citations) } as MarkdownProps['components']),
    [isGlobalEdition, components, citations],
  );

  return (
    <Markdown
      fontSize={fontSize}
      variant={'chat'}
      componentProps={{
        ...componentProps,
        highlight: {
          fullFeatured: true,
          theme: highlighterTheme,
          ...componentProps?.highlight,
        },
        mermaid: { fullFeatured: false, theme: mermaidTheme, ...componentProps?.mermaid },
      }}
      {...rest}
      components={markdownComponents}
      enableCustomFootnotes={isGlobalEdition && enableCustomFootnotes}
    >
      {children}
    </Markdown>
  );
});

export default MarkdownMessage;
