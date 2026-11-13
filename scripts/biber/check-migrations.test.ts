// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkMigrations } from './check-migrations';

const dirs: string[] = [];

/** A migrations folder holding the given journal entries, with SQL and snapshot files for each. */
const folder = (entries: { tag: string; when: number }[], extraSql: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'meta'));
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ entries: entries.map((entry, idx) => ({ idx, ...entry })) }),
  );
  for (const { tag } of entries) {
    writeFileSync(join(dir, `${tag}.sql`), 'select 1;');
    writeFileSync(join(dir, 'meta', `${tag.slice(0, 4)}_snapshot.json`), '{}');
  }
  for (const file of extraSql) writeFileSync(join(dir, file), 'select 1;');
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe('checkMigrations', () => {
  it('accepts a journal numbered in order with every file present', () => {
    const dir = folder([
      { tag: '0000_init', when: 1 },
      { tag: '0001_add_users', when: 2 },
    ]);

    expect(checkMigrations(dir)).toEqual([]);
  });

  it('reports two migrations given the same number by a merge', () => {
    const dir = folder([
      { tag: '0000_init', when: 1 },
      { tag: '0001_upstream_change', when: 2 },
      { tag: '0001_our_change', when: 3 },
    ]);

    expect(checkMigrations(dir)).toContain(
      'journal entry 2 is tagged 0001_our_change, expected 0002_…',
    );
  });

  it('reports a migration older than the one before it, which databases would skip', () => {
    const dir = folder([
      { tag: '0000_init', when: 5 },
      { tag: '0001_merged_late', when: 3 },
    ]);

    expect(checkMigrations(dir)).toEqual([
      expect.stringContaining('0001_merged_late is not newer than 0000_init'),
    ]);
  });

  it('reports a SQL file the journal does not list', () => {
    const dir = folder([{ tag: '0000_init', when: 1 }], ['0001_forgotten.sql']);

    expect(checkMigrations(dir)).toEqual([
      '0001_forgotten.sql is not in the journal, so it would never run',
    ]);
  });

  it('passes on the repository migrations', () => {
    expect(checkMigrations(join(__dirname, '../../packages/database/migrations'))).toEqual([]);
  });
});
