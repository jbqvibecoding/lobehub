import { Globe } from 'lucide-react';

import { useSiteIconUrl } from '@/hooks/useSiteIconUrl';
import Image from '@/libs/next/Image';

interface WebFaviconProps {
  alt?: string;
  size?: number;
  title?: string;
  url: string;
}

const WebFavicon = ({ url, title, alt, size = 14 }: WebFaviconProps) => {
  const siteIconUrl = useSiteIconUrl();
  const src = siteIconUrl(new URL(url).hostname);

  if (!src) return <Globe size={size} style={{ flexShrink: 0 }} />;

  return (
    <Image
      unoptimized
      alt={alt || title || url}
      height={size}
      src={src}
      style={{ borderRadius: 4 }}
      width={size}
    />
  );
};

export default WebFavicon;
