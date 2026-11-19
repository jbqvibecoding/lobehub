import { A, Block, ScrollShadow } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type GroundingSearch } from '@/types/search';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    min-width: 160px;
    max-width: 160px;
    height: 100%;
    font-size: 12px;
  `,
}));

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
};

/**
 * The search sources as cards, laid out like `SearchResultCards` from `@lobehub/ui` but without
 * its site icons, which come from DuckDuckGo. For editions that keep those requests at home.
 */
const SearchSourceCards = memo<{ citations: NonNullable<GroundingSearch['citations']> }>(
  ({ citations }) => (
    <ScrollShadow
      hideScrollBar
      horizontal
      gap={12}
      orientation={'horizontal'}
      size={10}
      style={{ minHeight: 80, overflowX: 'scroll', paddingInlineEnd: 24, width: '100%' }}
    >
      {citations.map((citation) => (
        <A href={citation.url} key={citation.url} rel="noreferrer" target="_blank">
          <Block
            clickable
            className={styles.card}
            gap={2}
            justify={'space-between'}
            paddingBlock={6}
            paddingInline={8}
            variant={'outlined'}
          >
            <Text ellipsis={{ rows: 2 }}>{citation.title || citation.url}</Text>
            <Text ellipsis type={'secondary'}>
              {citation.favicon || domainOf(citation.url)}
            </Text>
          </Block>
        </A>
      ))}
    </ScrollShadow>
  ),
);

SearchSourceCards.displayName = 'SearchSourceCards';

export default SearchSourceCards;
