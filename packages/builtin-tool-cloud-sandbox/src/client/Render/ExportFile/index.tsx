'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    maxWidth: '420px',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  failed: { overflow: 'hidden', paddingInlineStart: '8px', paddingInlineEnd: '0' },
  icon: { flex: 'none', color: cssVar.colorTextSecondary },
});

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

    const downloadUrl = pluginState?.downloadUrl;
    const downloadName = pluginState?.filename;
    const handleDownload = useCallback(async () => {
      if (!downloadUrl || !downloadName) return;

      try {
        // Fetch the file content to bypass cross-origin download restrictions
        const response = await fetch(downloadUrl);
        const blob = await response.blob();

        // Create a blob URL and trigger download
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = downloadName;
        document.body.append(link);
        link.click();
        link.remove();

        // Clean up the blob URL
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Fallback: open in new tab if fetch fails
        window.open(downloadUrl, '_blank');
      }
    }, [downloadUrl, downloadName]);

    if (pluginState === undefined) return null;

    if (!pluginState.success || !pluginState.downloadUrl) {
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.failed).className}
          gap={8}
        >
          <Icon color={cssVar.colorError} icon={CircleXIcon} size={12} />
          <Text code fontSize={12}>
            {t('builtins.lobe-cloud-sandbox.exportFile.failed', { path: args.path })}
          </Text>
        </Flexbox>
      );
    }

    const extension = filename.split('.').pop()?.toUpperCase();
    const details = [extension, formatSize(pluginState.size)].filter(Boolean).join(' · ');

    return (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.card).className} gap={12}>
        <Icon className={stylex.props(styles.icon).className} icon={iconFor(filename)} size={28} />
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
