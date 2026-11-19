'use client';

import { Flexbox } from '@lobehub/ui';
import { css, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import NotSupport from '../../NotSupport';

const container = css`
  position: relative;
  overflow: hidden;
  border-radius: 4px;
`;

const content = css`
  position: absolute;
  inset-block: -1px;
  inset-inline-start: -1px;

  width: calc(100% + 2px);
  height: calc(100% + 2px);
  border: 0;
`;

interface MSDocViewerProps {
  fileId: string;
  fileName?: string;
  url: string | null;
}

/**
 * Previews Office files with Microsoft's online viewer, whose servers download the whole file.
 * Only the Global edition sends files there; elsewhere the file can be downloaded instead.
 */
const MSDocViewer = memo<MSDocViewerProps>(({ fileName, url }) => {
  const { t } = useTranslation('file');
  const isGlobalEdition = useServerConfigStore(serverConfigSelectors.isGlobalEdition);

  if (!url) return null;

  if (!isGlobalEdition) {
    return (
      <NotSupport fileName={fileName} message={t('preview.officeOnlineUnavailable')} url={url} />
    );
  }

  return (
    <Flexbox className={cx(container)} height={'100%'} id="msdoc-renderer" width={'100%'}>
      <iframe
        className={cx(content)}
        id="msdoc-iframe"
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
        title="msdoc-iframe"
      />
    </Flexbox>
  );
});

export default MSDocViewer;
