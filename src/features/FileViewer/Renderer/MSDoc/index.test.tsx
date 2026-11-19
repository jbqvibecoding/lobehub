import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import MSDocViewer from './index';

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t: (key: string) => key }),
}));

const FILE_URL = 'https://app.example.com/f/file_1';

const renderIn = (region: 'cn' | 'global' | undefined) =>
  render(
    <Provider
      createStore={() =>
        initServerConfigStore({ serverConfig: { aiProvider: {}, region, telemetry: {} } })
      }
    >
      <MSDocViewer fileId="file_1" fileName="plan.docx" url={FILE_URL} />
    </Provider>,
  );

describe('MSDocViewer', () => {
  it('previews with Microsoft’s online viewer in the Global edition', () => {
    const { container } = renderIn('global');

    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(FILE_URL)}`,
    );
  });

  it.each([
    ['the mainland edition', 'cn'],
    ['an edition not yet known', undefined],
  ] as const)('offers a download instead of sending the file abroad in %s', (_, region) => {
    const { container } = renderIn(region);

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.innerHTML).not.toContain('officeapps');
    expect(screen.getByText('preview.officeOnlineUnavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'preview.downloadFile' })).toBeInTheDocument();
  });
});
