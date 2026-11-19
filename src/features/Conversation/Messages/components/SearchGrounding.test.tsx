import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import SearchGrounding from './SearchGrounding';

const citations = [
  { title: 'Pour-over basics', url: 'https://coffee.example.com/pour-over' },
  { favicon: 'tea.example.org', title: 'Green tea', url: 'https://redirect.example.net/r?id=1' },
];

const renderIn = (region: 'cn' | 'global') =>
  render(
    <Provider
      createStore={() =>
        initServerConfigStore({ serverConfig: { aiProvider: {}, region, telemetry: {} } })
      }
    >
      <SearchGrounding citations={citations} searchQueries={['coffee']} />
    </Provider>,
  );

const expand = () => fireEvent.click(screen.getByText('search.grounding.title'));

describe('SearchGrounding', () => {
  it('shows the sources with their DuckDuckGo icons in the Global edition', () => {
    const { container } = renderIn('global');

    expect(container.innerHTML).toContain('icons.duckduckgo.com/ip3/coffee.example.com');
  });

  it('lists the sources without asking DuckDuckGo for icons in the mainland edition', async () => {
    const { container } = renderIn('cn');
    expect(container.querySelector('img')).toBeNull();

    expand();

    expect(await screen.findByText('Pour-over basics')).toBeInTheDocument();
    expect(screen.getByText('coffee.example.com')).toBeInTheDocument();
    // A redirect link is labelled with the site it leads to
    expect(screen.getByText('tea.example.org')).toBeInTheDocument();
    expect(screen.getByText('Green tea').closest('a')).toHaveAttribute('href', citations[1].url);
    expect(container.innerHTML).not.toContain('duckduckgo');
  });
});
