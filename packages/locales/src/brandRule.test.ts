import { describe, expect, it } from 'vitest';

import { namesOnlyKeptServices, rebrandProductName } from './brandRule';

describe('rebrandProductName', () => {
  it('renames the product', () => {
    expect(rebrandProductName('LobeHub could not start Amp', 'Biber')).toBe(
      'Biber could not start Amp',
    );
    expect(rebrandProductName("LobeHub's standard cases · Biber-free", 'Biber')).toBe(
      "Biber's standard cases · Biber-free",
    );
    expect(rebrandProductName('LobeHub-hosted models', 'Biber')).toBe('Biber-hosted models');
  });

  it('keeps the LobeHub services Biber still points to, in every language', () => {
    for (const copy of [
      'Sign in to LobeHub Cloud',
      'Install the LobeHub CLI',
      'LobeHub Community',
      'LobeHub Marketplace',
      'LobeHub-Skills',
      'LobeHub‑Marktplatz',
      'LobeHub 市场 · LobeHub 社区 · LobeHub 技能 · LobeHub 云账户',
      'LobeHub 雲端 · LobeHub 市集 · LobeHub 社群',
      'LobeHub 클라우드 · LobeHub 마켓',
      'LobeHubマーケット · LobeHub クラウド',
      "LobeHub Bulut'a Bağlı",
      'LobeHub Облак',
    ]) {
      expect(rebrandProductName(copy, 'Biber')).toBe(copy);
    }
  });

  it('keeps social handles and identifiers', () => {
    expect(rebrandProductName('DM @LobeHub on Slack', 'Biber')).toBe('DM @LobeHub on Slack');
    expect(rebrandProductName('LobeHubModelDeprecated · useLobeHub', 'Biber')).toBe(
      'LobeHubModelDeprecated · useLobeHub',
    );
  });

  it('renames the pre-rename name, and reads a kept service under it as today’s name', () => {
    expect(rebrandProductName('幫助 LobeChat 做得更好', 'Biber')).toBe('幫助 Biber 做得更好');
    expect(rebrandProductName('リモートLobeChatサーバー', 'Biber')).toBe('リモートBiberサーバー');
    expect(rebrandProductName('使用 <3>LobeChat Cloud</3>', 'Biber')).toBe(
      '使用 <3>LobeHub Cloud</3>',
    );
  });
});

describe('namesOnlyKeptServices', () => {
  it('holds for English that names only kept services', () => {
    expect(namesOnlyKeptServices('Share your creation on LobeHub Marketplace today', 'Biber')).toBe(
      true,
    );
  });

  it('does not hold when the copy also names the product or the brand, or neither', () => {
    expect(namesOnlyKeptServices('Use the LobeHub CLI to reach LobeHub', 'Biber')).toBe(false);
    expect(namesOnlyKeptServices('Biber connects to LobeHub Cloud', 'Biber')).toBe(false);
    expect(namesOnlyKeptServices('Start a new topic', 'Biber')).toBe(false);
  });
});
