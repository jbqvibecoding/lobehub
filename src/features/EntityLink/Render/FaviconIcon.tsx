import { Globe } from 'lucide-react';
import { memo, useState } from 'react';

import { useSiteIconUrl } from '@/hooks/useSiteIconUrl';

interface FaviconIconProps {
  domain: string;
  size?: number;
}

/**
 * Inline site favicon for generic external links. Falls back to a globe glyph
 * when the favicon cannot be loaded, or this edition does not load site icons.
 */
const FaviconIcon = memo<FaviconIconProps>(({ domain, size = 15 }) => {
  const [failed, setFailed] = useState(false);
  const src = useSiteIconUrl()(domain);

  if (failed || !src) return <Globe size={size} />;

  return (
    <img
      alt=""
      height={size}
      src={src}
      style={{ borderRadius: 3, objectFit: 'contain' }}
      width={size}
      onError={() => setFailed(true)}
    />
  );
});

FaviconIcon.displayName = 'FaviconIcon';

export default FaviconIcon;
