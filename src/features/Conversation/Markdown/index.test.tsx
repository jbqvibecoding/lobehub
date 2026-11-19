import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import MarkdownMessage from './index';

const citations = [{ title: 'Coffee guide', url: 'https://coffee.example.com/guide' }];

const MODEL_CITATION = 'Brew it hot [1](citation-1).';
const FOOTNOTE = 'Brew it hot[^1].\n\n[^1]: [Coffee guide](https://coffee.example.com/guide)';

const renderIn = (region: 'cn' | 'global', markdown = MODEL_CITATION) =>
  render(
    <Provider
      createStore={() =>
        initServerConfigStore({ serverConfig: { aiProvider: {}, region, telemetry: {} } })
      }
    >
      <MarkdownMessage enableCustomFootnotes citations={citations} enableStream={false}>
        {markdown}
      </MarkdownMessage>
    </Provider>,
  );

const hoverCitation = async () => {
  // The marker in the text comes before any numbered source list under it
  const [marker] = await screen.findAllByText('1');
  const target = marker.closest('sup') ?? marker;
  await act(async () => {
    fireEvent.pointerEnter(target, { pointerType: 'mouse' });
    fireEvent.mouseEnter(target);
    fireEvent.mouseMove(target);
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  return marker;
};

describe('MarkdownMessage citations', () => {
  it('shows the source card with its DuckDuckGo icon in the Global edition', async () => {
    renderIn('global');
    await hoverCitation();

    expect(document.body.innerHTML).toContain('icons.duckduckgo.com/ip3/coffee.example.com');
  });

  it('links the marker straight to the source and loads no icon in the mainland edition', async () => {
    renderIn('cn');
    const marker = await hoverCitation();

    expect(marker.closest('a')).toHaveAttribute('href', citations[0].url);
    expect(marker.closest('a')).toHaveAttribute('title', citations[0].title);
    expect(document.body.innerHTML).not.toContain('duckduckgo');
  });

  it.each([
    ['global', true],
    ['cn', false],
  ] as const)('footnote markers in the %s edition load an icon: %s', async (region, loads) => {
    renderIn(region, FOOTNOTE);
    await hoverCitation();

    expect(document.body.innerHTML.includes('duckduckgo')).toBe(loads);
  });
});
