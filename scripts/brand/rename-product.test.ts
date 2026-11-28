// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { jsonCopyStrings, rebrandFile, renderKeptKeys, run, tsCopyStrings } from './rename-product';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const rebrandJson = (raw: string, kept: string[] = []) =>
  rebrandFile(raw, jsonCopyStrings(raw), 'setting', new Set(kept)).text;

const rebrandTs = (raw: string, kept: string[] = []) =>
  rebrandFile(raw, tsCopyStrings(raw), 'setting', new Set(kept)).text;

describe('JSON locale files', () => {
  it('renames values only, leaving keys and the formatting as they were', () => {
    const raw = [
      '{',
      '  "about.LobeHub": "About LobeHub",',
      '  "cloud": "Sign in to LobeHub Cloud",',
      '  "handle":   "DM @LobeHub",',
      '  "tray": { "title": "LobeHub is running", "items": ["Quit LobeHub"] }',
      '}',
      '',
    ].join('\n');

    expect(rebrandJson(raw)).toBe(
      [
        '{',
        '  "about.LobeHub": "About Biber",',
        '  "cloud": "Sign in to LobeHub Cloud",',
        '  "handle":   "DM @LobeHub",',
        '  "tray": { "title": "Biber is running", "items": ["Quit Biber"] }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('decides on the decoded text, so an escape is not read as a letter', () => {
    expect(rebrandJson('{ "a": "Hi\\nLobeHub runs \\"LobeHub\\"" }')).toBe(
      '{ "a": "Hi\\nBiber runs \\"Biber\\"" }',
    );
  });

  it('keeps copy kept by key, nested keys by their path', () => {
    const raw = '{ "kept": "LobeHub", "tray": { "title": "LobeHub" }, "other": "LobeHub" }';

    expect(rebrandJson(raw, ['setting:kept', 'setting:tray.title'])).toBe(
      '{ "kept": "LobeHub", "tray": { "title": "LobeHub" }, "other": "Biber" }',
    );
  });
});

describe('English source files', () => {
  it('renames string values, leaving keys, comments and quotes as they were', () => {
    const raw = [
      '// LobeHub copy',
      'export default {',
      "  'error.LobeHubModelDeprecated': 'LobeHub retired this model',",
      '  "about": "About LobeHub\'s app",',
      '  nested: { title: `LobeHub CLI and LobeHub` },',
      '};',
      '',
    ].join('\n');

    expect(rebrandTs(raw)).toBe(
      [
        '// LobeHub copy',
        'export default {',
        "  'error.LobeHubModelDeprecated': 'Biber retired this model',",
        '  "about": "About Biber\'s app",',
        '  nested: { title: `LobeHub CLI and Biber` },',
        '};',
        '',
      ].join('\n'),
    );
  });
});

describe('run', () => {
  const tree = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rename-product-'));
    dirs.push(root);
    mkdirSync(path.join(root, 'packages/locales/src/default'), { recursive: true });
    mkdirSync(path.join(root, 'locales/bg-BG'), { recursive: true });
    writeFileSync(
      path.join(root, 'packages/locales/src/default/discover.ts'),
      "export default {\n  'footer.title': 'Share on LobeHub Marketplace',\n  'restart': 'Restarting LobeHub…',\n};\n",
    );
    writeFileSync(
      path.join(root, 'locales/bg-BG/discover.json'),
      '{\n  "footer.title": "Споделете в Пазара на LobeHub",\n  "restart": "LobeHub се рестартира…"\n}\n',
    );
    writeFileSync(path.join(root, 'packages/locales/src/brandKeptKeys.ts'), '');
    return root;
  };

  it('lists what needs renaming without writing in check mode', () => {
    const root = tree();
    const before = readFileSync(path.join(root, 'locales/bg-BG/discover.json'), 'utf8');

    expect(run(root, true)).toEqual({ files: 2, staleKeptKeys: true, total: 2 });
    expect(readFileSync(path.join(root, 'locales/bg-BG/discover.json'), 'utf8')).toBe(before);
  });

  it('keeps every translation of copy whose English names only kept services', () => {
    const root = tree();
    run(root, false);

    expect(readFileSync(path.join(root, 'locales/bg-BG/discover.json'), 'utf8')).toBe(
      '{\n  "footer.title": "Споделете в Пазара на LobeHub",\n  "restart": "Biber се рестартира…"\n}\n',
    );
    expect(readFileSync(path.join(root, 'packages/locales/src/brandKeptKeys.ts'), 'utf8')).toBe(
      renderKeptKeys(['discover:footer.title']),
    );
    expect(run(root, true)).toEqual({ files: 0, staleKeptKeys: false, total: 0 });
  });
});
