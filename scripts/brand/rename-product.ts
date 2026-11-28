/**
 * Renames upstream's product name, LobeHub (and its pre-rename name LobeChat), to Biber in the
 * interface copy of every language. Run it after each merge from upstream LobeHub, which keeps
 * adding copy that names the product:
 *
 *   bunx tsx scripts/brand/rename-product.ts          # rewrite the files
 *   bunx tsx scripts/brand/rename-product.ts --check  # list what still needs renaming, exit 1 if any
 *
 * The rule is packages/locales/src/brandRule.ts, shared with the runtime rewrite of translations:
 * LobeHub Cloud, the Community, the Market and its skills, and the CLI keep their names. The
 * script also writes packages/locales/src/brandKeptKeys.ts, the keys whose English names only
 * those services, for the runtime to keep in every language.
 *
 * Only copy is touched: the values in locales/<lang>/*.json and in the English source,
 * packages/locales/src/default. Keys, comments and code keep their names. Text the server shows
 * the model (prompts, billing messages) is not covered and is read by hand at each merge.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import {
  KEPT_BY_MEANING,
  namesOnlyKeptServices,
  PRODUCT_NAME,
  rebrandedProductNameAt,
} from '../../packages/locales/src/brandRule';

const BRAND = 'Biber';

const LOCALES_DIR = 'locales';
const DEFAULT_DIR = 'packages/locales/src/default';
const KEPT_KEYS_FILE = 'packages/locales/src/brandKeptKeys.ts';

/** A string in a source file: where its raw text sits, its decoded value and its key path. */
interface CopyString {
  end: number;
  key: string;
  start: number;
  value: string;
}

/**
 * Rewrite the raw text of one string, deciding on its decoded value. The names never contain an
 * escape, so the n-th name in the raw text is the n-th in the value; deciding on the value keeps
 * an escape such as `\n` from reading as a letter before the name.
 */
const rebrandRaw = (raw: string, value: string): string => {
  const decisions = [...value.matchAll(PRODUCT_NAME)].map((match) =>
    rebrandedProductNameAt(value, match.index, match[0], BRAND),
  );
  let index = 0;
  const next = raw.replaceAll(PRODUCT_NAME, (name: string) => decisions[index++] ?? name);

  if (index !== decisions.length) throw new Error(`Escaped brand name in ${JSON.stringify(raw)}`);
  return next;
};

/** The value strings of a JSON locale file, keyed by their path of object keys. */
export const jsonCopyStrings = (raw: string): CopyString[] => {
  const strings: CopyString[] = [];
  const levels: { key?: string; object: boolean }[] = [];

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (char === '{' || char === '[') levels.push({ object: char === '{' });
    else if (char === '}' || char === ']') levels.pop();
    else if (char === '"') {
      let end = i + 1;
      while (raw[end] !== '"') end += raw[end] === '\\' ? 2 : 1;
      end += 1;

      let after = end;
      while (/\s/.test(raw[after] ?? '')) after++;
      const level = levels.at(-1);
      const value = JSON.parse(raw.slice(i, end)) as string;

      if (raw[after] === ':' && level?.object) level.key = value;
      else {
        const key = levels
          .filter((l) => l.object && l.key !== undefined)
          .map((l) => l.key)
          .join('.');
        strings.push({ end, key, start: i, value });
      }
      i = end - 1;
    }
  }

  return strings;
};

const propertyName = (name: ts.PropertyName) =>
  ts.isStringLiteral(name) || ts.isIdentifier(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;

/** The string-literal values of an English source file, keyed by their path of property names. */
export const tsCopyStrings = (raw: string): CopyString[] => {
  const source = ts.createSourceFile('copy.ts', raw, ts.ScriptTarget.Latest, true);
  const strings: CopyString[] = [];

  const visit = (node: ts.Node, keys: string[]) => {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      const path = name === undefined ? keys : [...keys, name];
      const init = node.initializer;

      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        strings.push({
          end: init.end,
          key: path.join('.'),
          start: init.getStart(),
          value: init.text,
        });
        return;
      }
      ts.forEachChild(node, (child) => visit(child, path));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, keys));
  };
  visit(source, []);

  return strings;
};

/** Rename the product in the strings of one file whose `namespace:key` is not kept. */
export const rebrandFile = (
  raw: string,
  strings: CopyString[],
  namespace: string,
  keptKeys: ReadonlySet<string>,
): { changes: number; text: string } => {
  let text = raw;
  let changes = 0;

  for (const { end, key, start, value } of [...strings].reverse()) {
    if (keptKeys.has(`${namespace}:${key}`) || value.search(PRODUCT_NAME) < 0) continue;

    const before = text.slice(start, end);
    const after = rebrandRaw(before, value);
    if (after === before) continue;

    text = text.slice(0, start) + after + text.slice(end);
    changes++;
  }

  return { changes, text };
};

/** Keys whose English names only LobeHub services, so every translation keeps the name. */
export const englishKeptKeys = (english: { namespace: string; strings: CopyString[] }[]) =>
  english
    .flatMap(({ namespace, strings }) =>
      strings
        .filter(({ value }) => namesOnlyKeptServices(value, BRAND))
        .map(({ key }) => `${namespace}:${key}`),
    )
    .filter((key) => !KEPT_BY_MEANING.includes(key))
    .sort();

export const renderKeptKeys = (keys: string[]) =>
  [
    '// Written by scripts/brand/rename-product.ts: the keys whose English names only LobeHub',
    '// services Biber keeps (LobeHub Cloud, the Market, the CLI), so every translation keeps the',
    '// name. Do not edit by hand; run the script.',
    'export const BRAND_KEPT_KEYS: readonly string[] = [',
    ...keys.map((key) => `  '${key}',`),
    '];',
    '',
  ].join('\n');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** `packages/locales/src/default/verify/evidence.ts` → `verify` */
const namespaceOf = (base: string, file: string) =>
  path
    .relative(base, file)
    .split(path.sep)[0]
    .replace(/\.(json|ts)$/, '');

export const run = (root: string, check: boolean) => {
  const defaultDir = path.join(root, DEFAULT_DIR);
  const english = walk(defaultDir)
    .filter((file) => file.endsWith('.ts') && !/\.test\.ts$|\/index\.ts$/.test(file))
    .map((file) => {
      const raw = readFileSync(file, 'utf8');
      return { file, namespace: namespaceOf(defaultDir, file), raw, strings: tsCopyStrings(raw) };
    });

  const derived = englishKeptKeys(english);
  const keptKeys = new Set([...KEPT_BY_MEANING, ...derived]);

  const localesDir = path.join(root, LOCALES_DIR);
  const translated = walk(localesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const raw = readFileSync(file, 'utf8');
      return {
        file,
        namespace: path.basename(file, '.json'),
        raw,
        strings: jsonCopyStrings(raw),
      };
    });

  let files = 0;
  let total = 0;
  for (const { file, namespace, raw, strings } of [...english, ...translated]) {
    const { changes, text } = rebrandFile(raw, strings, namespace, keptKeys);
    if (changes === 0) continue;

    files++;
    total += changes;
    console.log(`${path.relative(root, file)}: ${changes}`);
    if (!check) writeFileSync(file, text);
  }

  const keptKeysFile = path.join(root, KEPT_KEYS_FILE);
  const keptKeysText = renderKeptKeys(derived);
  let current = '';
  try {
    current = readFileSync(keptKeysFile, 'utf8');
  } catch {
    // Not written yet
  }
  const staleKeptKeys = current !== keptKeysText;
  if (staleKeptKeys) {
    console.log(`${KEPT_KEYS_FILE}: out of date`);
    if (!check) writeFileSync(keptKeysFile, keptKeysText);
  }

  return { files, staleKeptKeys, total };
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const check = process.argv.includes('--check');
  const { files, staleKeptKeys, total } = run(path.resolve(__dirname, '..', '..'), check);

  if (check) {
    if (total > 0 || staleKeptKeys) {
      console.error(
        `\n${total} strings in ${files} files still name LobeHub` +
          `${staleKeptKeys ? ', and the kept keys are out of date' : ''}. ` +
          'Run: bunx tsx scripts/brand/rename-product.ts',
      );
      process.exitCode = 1;
    } else console.log('The product name is Biber everywhere it should be.');
  } else console.log(`Renamed ${total} strings in ${files} files.`);
}
