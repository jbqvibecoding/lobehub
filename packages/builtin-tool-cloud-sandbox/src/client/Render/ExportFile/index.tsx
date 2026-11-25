'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CircleXIcon,
  DownloadIcon,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Presentation,
} from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExportFileState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    overflow: hidden;

    max-width: 420px;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  failed: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  icon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface ExportFileParams {
  path: string;
}

const iconFor = (filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'pptx') return Presentation;
  if (extension === 'xlsx' || extension === 'csv') return FileSpreadsheet;
  if (extension === 'docx' || extension === 'pdf' || extension === 'md') return FileText;
  return FileIcon;
};

const formatSize = (bytes?: number) => {
  if (!bytes) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** A file handed over from the sandbox, shown as a card to download; a failed export as one line. */
const ExportFile = memo<BuiltinRenderProps<ExportFileParams, ExportFileState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const filename = pluginState?.filename || args.path.split('/').pop() || args.path;

    const handleDownload = useCallback(async () => {
      if (!pluginState?.downloadUrl || !pluginState?.filename) return;

      try {
        // Fetch the file content to bypass cross-origin download restrictions
        const response = await fetch(pluginState.downloadUrl);
        const blob = await response.blob();

        // Create a blob URL and trigger download
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = pluginState.filename;
        document.body.append(link);
        link.click();
        link.remove();

        // Clean up the blob URL
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Fallback: open in new tab if fetch fails
        window.open(pluginState.downloadUrl, '_blank');
      }
    }, [pluginState?.downloadUrl, pluginState?.filename]);

    if (pluginState === undefined) return null;

    if (!pluginState.success || !pluginState.downloadUrl) {
      return (
        <Flexbox horizontal align={'center'} className={styles.failed} gap={8}>
          <Icon color={cssVar.colorError} icon={CircleXIcon} size={12} />
          <Text code fontSize={12}>
            {t('builtins.lobe-cloud-sandbox.exportFile.failed', { path: args.path })}
          </Text>
        </Flexbox>
      );
    }

    const TypeIcon = iconFor(filename);
    const extension = filename.split('.').pop()?.toUpperCase();
    const details = [extension, formatSize(pluginState.size)].filter(Boolean).join(' · ');

    return (
      <Flexbox horizontal align={'center'} className={styles.card} gap={12}>
        <TypeIcon className={styles.icon} size={28} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {filename}
          </Text>
          {details && (
            <Text fontSize={12} type={'secondary'}>
              {details}
            </Text>
          )}
        </Flexbox>
        <ActionIcon
          icon={DownloadIcon}
          title={t('builtins.lobe-cloud-sandbox.exportFile.download')}
          onClick={handleDownload}
        />
      </Flexbox>
    );
  },
);

ExportFile.displayName = 'ExportFile';

export default ExportFile;
