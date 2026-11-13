/**
 * Checks that the Drizzle migrations still line up, which a merge from upstream LobeHub can
 * silently break when both sides added migrations with the same number:
 *
 *   bunx tsx scripts/biber/check-migrations.ts [migrations-dir]
 *
 * - journal entries are numbered 0, 1, 2… with no gap or repeat, and each tag starts with its number;
 * - every journal entry has its SQL file and its snapshot;
 * - every SQL file is in the journal (a file drizzle would never run is a lost migration);
 * - the journal's timestamps only increase, since drizzle applies a migration only when it is newer
 *   than the last one the database recorded.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** SQL files upstream left behind outside the journal; they are not migrations and never run. */
const KNOWN_STRAY_SQL = new Set(['0065_add_document_fields.sql']);

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export const checkMigrations = (dir: string): string[] => {
  const problems: string[] = [];
  const journalPath = join(dir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) return [`no journal at ${journalPath}`];

  const entries = (JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] })
    .entries;

  entries.forEach((entry, position) => {
    const number = String(position).padStart(4, '0');
    if (entry.idx !== position) {
      problems.push(`journal entry ${position} (${entry.tag}) has idx ${entry.idx}`);
    }
    if (!entry.tag.startsWith(`${number}_`)) {
      problems.push(`journal entry ${position} is tagged ${entry.tag}, expected ${number}_…`);
    }
    if (!existsSync(join(dir, `${entry.tag}.sql`))) {
      problems.push(`${entry.tag}: the SQL file is missing`);
    }
    if (!existsSync(join(dir, 'meta', `${number}_snapshot.json`))) {
      problems.push(`${entry.tag}: meta/${number}_snapshot.json is missing`);
    }
    const previous = entries[position - 1];
    if (previous && entry.when <= previous.when) {
      problems.push(
        `${entry.tag} is not newer than ${previous.tag} (when ${entry.when} <= ${previous.when}); ` +
          'databases that already ran the earlier one would skip it',
      );
    }
  });

  const tags = new Set(entries.map((entry) => entry.tag));
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    if (!tags.has(file.slice(0, -4)) && !KNOWN_STRAY_SQL.has(file)) {
      problems.push(`${file} is not in the journal, so it would never run`);
    }
  }

  return problems;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const dir = resolve(process.argv[2] ?? 'packages/database/migrations');
  const problems = checkMigrations(dir);
  if (problems.length === 0) {
    console.log(`Migrations line up (${dir}).`);
  } else {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exitCode = 1;
  }
}
