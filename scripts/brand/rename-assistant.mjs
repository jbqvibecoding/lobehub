#!/usr/bin/env node
/**
 * Renames LobeHub's default assistant, "Lobe AI" (also written "LobeAI"), to Biber in interface
 * text in every language, prompts, code comments and tests. Run it again after each merge from
 * upstream LobeHub, which keeps adding text that names the assistant:
 *
 *   node scripts/brand/rename-assistant.mjs          # rewrite the files
 *   node scripts/brand/rename-assistant.mjs --check  # list what still needs renaming, exit 1 if any
 *
 * Translation keys and identifiers keep their names (`cmdk.askLobeAI`, `handleAskLobeAI`): only a
 * standalone "LobeAI" is renamed. LobeHub's own documentation under docs/ and the upstream agent
 * skills are left alone, as the Biber rebrand did.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const NAME = 'Biber';
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|feature|md|mdx|ya?ml)$/;
const SKIPPED = [
  /^docs\//,
  /^\.agents\//,
  /^\.claude\//,
  /(^|\/)CHANGELOG/i,
  /^changelog\//,
  // This script names what it replaces
  /^scripts\/brand\/rename-assistant\.mjs$/,
];

const RULES = [
  // The command menu matches the typed @mention against the assistant's name
  [/'lobe ai'\.includes\(/g, `'${NAME.toLowerCase()}'.includes(`],
  [/Lobe AI/g, NAME],
  // "LobeAI" on its own, not inside a key or identifier such as copyLobeAI or LobeAIIcon
  [/(?<![\w./-])LobeAI(?![\w-])/g, NAME],
];

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((file) => TEXT_FILE.test(file) && !SKIPPED.some((pattern) => pattern.test(file)));

const check = process.argv.includes('--check');
let changedFiles = 0;
let replacements = 0;

for (const file of files) {
  const full = path.join(root, file);
  const before = readFileSync(full, 'utf8');
  let after = before;
  for (const [pattern, replacement] of RULES) {
    after = after.replace(pattern, () => {
      replacements += 1;
      return replacement;
    });
  }
  if (after === before) continue;

  changedFiles += 1;
  if (check) console.log(file);
  else writeFileSync(full, after);
}

if (check) {
  console.log(
    changedFiles === 0
      ? 'The default assistant is called Biber everywhere.'
      : `${replacements} mentions of Lobe AI left in ${changedFiles} files`,
  );
  if (changedFiles > 0) process.exitCode = 1;
} else {
  console.log(`Renamed ${replacements} mentions of Lobe AI in ${changedFiles} files`);
}
