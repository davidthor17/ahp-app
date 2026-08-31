// No migration in this repository may write to an existing audit.
//
// Every column the scoring work adds is nullable and additive, and null is the
// correct value for every row that predates it. The danger was never the DDL:
// it was the draft UPDATE that sat commented at the bottom of the Phase 4B
// file, copying today's property row into six columns for every audit whose
// basis was null. Running it would have stated, as recorded fact, conditions
// nobody recorded.
//
// It has been removed. This test is what stops it, or anything like it, coming
// back during a tidy-up of columns full of nulls. It reads the raw file text,
// comments included, because a commented UPDATE beside an empty column is an
// invitation and the whole point is that it should not be there to paste.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
const read = (f) => readFileSync(path.join(MIGRATIONS, f), 'utf8');

/** Executable SQL only: comments stripped, blank lines removed. */
const statements = (body) => body
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

test('there are migrations to check, so this test is not vacuous', () => {
  assert.ok(files.length >= 3, `expected the three scoring migrations, found ${files.length}`);
  for (const expected of [
    '2026-08-28-phase4b-scoring-integrity.sql',
    '2026-08-29-phase4c-dependency-flags.sql',
    '2026-08-30-phase55-published-result.sql',
  ]) {
    assert.ok(files.includes(expected), `${expected} is missing`);
  }
});

test('no migration writes data, in any statement', () => {
  for (const file of files) {
    const sql = statements(read(file)).toLowerCase();
    for (const verb of ['update ', 'delete ', 'truncate ', 'insert ']) {
      assert.equal(sql.includes(verb), false, `${file} contains a ${verb.trim()} statement`);
    }
  }
});

test('no migration mentions a backfill of audits or properties, comments included', () => {
  // Deliberately reads the raw text. A commented draft is the thing that gets
  // pasted at 2am when somebody decides the nulls look untidy.
  for (const file of files) {
    const raw = read(file).toLowerCase();
    assert.equal(/update\s+public\.audits/.test(raw), false,
      `${file} contains an update of public.audits, even if commented`);
    assert.equal(/update\s+public\.properties/.test(raw), false,
      `${file} contains an update of public.properties, even if commented`);
    assert.equal(/update\s+public\.audit_items/.test(raw), false,
      `${file} contains an update of public.audit_items, even if commented`);
  }
});

test('no migration drops or renames an existing column', () => {
  for (const file of files) {
    const sql = statements(read(file)).toLowerCase();
    assert.equal(sql.includes('drop column'), false, `${file} drops a column`);
    assert.equal(sql.includes('rename'), false, `${file} renames something`);
    assert.equal(sql.includes('drop table'), false, `${file} drops a table`);
  }
});

test('every column added is nullable with no default', () => {
  for (const file of files) {
    const sql = statements(read(file)).toLowerCase();
    if (!sql.includes('add column')) continue;
    assert.equal(sql.includes('not null'), false, `${file} adds a not null column`);
    assert.equal(/add column[^;]*\bdefault\b/.test(sql), false, `${file} adds a column with a default`);
  }
});

test('every migration is idempotent and transactional', () => {
  for (const file of files) {
    const sql = statements(read(file)).toLowerCase();
    assert.ok(sql.includes('begin;'), `${file} is not wrapped in a transaction`);
    assert.ok(sql.includes('commit;'), `${file} does not commit`);
    const adds = (sql.match(/add column/g) || []).length;
    const guarded = (sql.match(/add column if not exists/g) || []).length;
    assert.equal(adds, guarded, `${file} has an unguarded add column`);
  }
});

test('the Phase 4B file records why there is no backfill', () => {
  // The absence should be deliberate and documented, not merely an omission
  // somebody later reads as an oversight.
  const raw = read('2026-08-28-phase4b-scoring-integrity.sql');
  assert.ok(/no backfill/i.test(raw), 'the file should state that there is no backfill');
  assert.ok(raw.includes('AHP-2026-8B10'), 'and name the published audit it protects');
});

test('the Phase 4B DDL still adds exactly the eight columns it is meant to', () => {
  // Removing the backfill must not have removed anything that matters.
  const sql = statements(read('2026-08-28-phase4b-scoring-integrity.sql'));
  for (const column of [
    'property_category', 'facility_profile', 'scope_sections',
    'framework_version', 'checklist_version', 'snapshot_locked_at',
    'na_reason', 'na_note',
  ]) {
    assert.ok(sql.includes(column), `${column} is missing from the migration`);
  }
  assert.ok(sql.includes('audit_items_na_reason_check'), 'the na_reason constraint is missing');
  assert.ok(sql.includes('reviewer reads activity log'), 'the reviewer policy is missing');
});
