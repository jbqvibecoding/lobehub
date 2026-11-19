import { type MarkdownProps } from '@lobehub/ui';
import { Link } from '@lobehub/ui/mdx';
import { type ComponentProps } from 'react';

type LinkProps = ComponentProps<'a'> & { node?: unknown };

/**
 * The Markdown link renderer for editions that do not load site icons from DuckDuckGo.
 *
 * `@lobehub/ui` shows a hover card for a model's `citation-N` marker, with the source's icon from
 * DuckDuckGo. Here the marker links straight to the source, its title in the browser's tooltip.
 * Every other link renders as before.
 */
export const linkWithoutSiteIcons =
  (citations: MarkdownProps['citations']) =>
  ({ node: _node, ...props }: LinkProps) => {
    const index = props.href?.match(/citation-(\d+)/)?.[1];
    if (!index) return <Link {...props} />;

    const citation = citations?.[Number(index) - 1];

    return (
      <sup>
        {citation?.url ? (
          <a href={citation.url} rel="noreferrer" target="_blank" title={citation.title}>
            {index}
          </a>
        ) : (
          index
        )}
      </sup>
    );
  };
