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

// Storage migrations are held to a different and narrower rule than schema
// ones. Creating a bucket is a row in storage.buckets, so it needs an insert
// and cannot satisfy the blanket no-INSERT rule below. Rather than relax that
// rule for every file, storage migrations are listed here and checked
// separately, and their check is stricter: they may not name an audit table at
// all, so an insert in one can never reach audit data.
const STORAGE_MIGRATIONS = ['2026-09-09-phase60-photo-storage.sql'];
const SCHEMA_FILES = files.filter((f) => !STORAGE_MIGRATIONS.includes(f));

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

test('no schema migration writes data, in any statement', () => {
  for (const file of SCHEMA_FILES) {
    const sql = statements(read(file)).toLowerCase();
    for (const verb of ['update ', 'delete from', 'truncate ', 'insert ']) {
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

// ── Phase 5.8 P0-B: the checklist pin column ────────────────────────────────

test('the checklist pin migration exists and adds exactly one nullable column', () => {
  const file = '2026-09-09-phase58-checklist-pin.sql';
  assert.ok(files.includes(file), `${file} is missing`);

  const sql = statements(read(file));
  assert.match(sql, /add column if not exists\s+checklist_items\s+jsonb/i);
  assert.equal((sql.match(/add column/gi) || []).length, 1, 'exactly one column');
  // The rules the other migrations are held to are asserted for all files
  // above. These are the two that would specifically ruin this one.
  assert.equal(/default/i.test(sql), false, 'a default would empty every audit');
  assert.equal(/not null/i.test(sql), false);
});

test('the pin migration records why an empty array must never be a default', () => {
  // The trap is specific to this column: '[]' is a real statement that no item
  // applies, so a well-meaning default would empty all seven existing audits.
  const raw = read('2026-09-09-phase58-checklist-pin.sql');
  assert.match(raw, /empty array/i, 'the file should say why the default is absent');
  assert.match(raw, /AHP-2026-D699/, 'and name the audit nobody should quietly fix');
});

test('the pin migration states the rollout order it depends on', () => {
  // Deploying the code first breaks every basis write with 42703.
  const raw = read('2026-09-09-phase58-checklist-pin.sql');
  assert.match(raw, /42703/, 'the file should name the failure the wrong order causes');
  assert.match(raw, /apply this migration/i);
});

// ── Phase 6.0: photo evidence ───────────────────────────────────────────────

test('the photo evidence migration creates a table and alters nothing', () => {
  const file = '2026-09-09-phase60-photo-evidence.sql';
  assert.ok(files.includes(file), `${file} is missing`);
  const sql = statements(read(file)).toLowerCase();

  assert.match(sql, /create table if not exists public\.audit_item_photos/);
  // The whole safety claim: it touches no existing table.
  assert.equal(/alter table public\.audits\b/.test(sql), false, 'it must not alter audits');
  assert.equal(/alter table public\.audit_items\b/.test(sql), false, 'it must not alter audit_items');
  assert.equal(/alter table public\.properties\b/.test(sql), false, 'it must not alter properties');
  // Its only ALTER is enabling RLS on the table it just made.
  assert.match(sql, /alter table public\.audit_item_photos\s+enable row level security/);
});

test('photo evidence is bound to the audit, the item and the shift', () => {
  // The same checklist item is evaluated once per shift, and D699 already
  // holds one graded differently in two. A photo keyed on (audit, item) alone
  // would be evidence for a verdict nobody could identify.
  const sql = statements(read('2026-09-09-phase60-photo-evidence.sql')).toLowerCase();
  assert.match(sql, /foreign key \(audit_id, item_id, shift_id\)/);
  assert.match(sql, /references public\.audit_items \(audit_id, item_id, shift_id\)/);
  assert.match(sql, /on delete cascade/);
  const flat = sql.replace(/\s+/g, ' ');
  for (const col of ['audit_id uuid not null', 'item_id text not null', 'shift_id text not null', 'storage_path text not null']) {
    assert.ok(flat.includes(col), `missing: ${col}`);
  }
});

test('photo evidence carries no public read policy', () => {
  // Phase 6.0 does not publish evidence, and the absence of the policy is what
  // guarantees that rather than the absence of a button.
  const sql = statements(read('2026-09-09-phase60-photo-evidence.sql')).toLowerCase();
  assert.match(sql, /create policy "internal manages own audit item photos"/);
  assert.match(sql, /create policy "internal reads all audit item photos"/);
  assert.match(sql, /create policy "reviewer reads all audit item photos"/);
  assert.equal(/public reads/.test(sql), false, 'no public policy may exist yet');
  assert.equal(/to anon/.test(sql), false, 'and anon is granted nothing');
});

test('the reviewer is given select on evidence and nothing more', () => {
  const sql = statements(read('2026-09-09-phase60-photo-evidence.sql')).toLowerCase();
  const reviewer = sql.slice(sql.indexOf('create policy "reviewer reads all audit item photos"'));
  const block = reviewer.slice(0, reviewer.indexOf(';') + 1);
  assert.match(block, /for select/);
  assert.equal(/for all/.test(block), false, 'a reviewer must never get an ALL policy');
});

test('the storage migration touches storage only and never an audit table', () => {
  const file = '2026-09-09-phase60-photo-storage.sql';
  assert.ok(files.includes(file), `${file} is missing`);
  assert.ok(STORAGE_MIGRATIONS.includes(file), 'and it is declared as a storage migration');
  const sql = statements(read(file)).toLowerCase();

  // The narrower rule that replaces the blanket no-INSERT one: the only insert
  // it may carry is the bucket itself.
  const inserts = sql.match(/insert\s+into\s+([a-z_.]+)/g) || [];
  assert.deepEqual(inserts, ['insert into storage.buckets'], 'only the bucket may be inserted');
  for (const t of ['public.audits', 'public.audit_items', 'public.properties', 'public.audit_item_photos']) {
    assert.equal(sql.includes(`into ${t}`), false, `${file} must not write ${t}`);
    assert.equal(new RegExp(`(update|delete\s+from)\s+${t.replace('.', '\.')}`).test(sql), false,
      `${file} must not modify ${t}`);
  }
  assert.equal(/truncate/.test(sql), false);
});

test('the evidence bucket is private, size-limited and image-only', () => {
  const sql = statements(read('2026-09-09-phase60-photo-storage.sql')).toLowerCase();
  assert.match(sql, /'audit-evidence'/);
  // The third positional value is `public`. It must be false.
  assert.match(sql, /'audit-evidence',\s*'audit-evidence',\s*false/);
  assert.equal(/public\)\s*values[^;]*true/.test(sql), false, 'the bucket must never be public');
  assert.match(sql, /10485760/, 'a size limit is set');
  assert.match(sql, /image\/jpeg/);
  assert.match(sql, /on conflict \(id\) do nothing/, 'and re-running it is harmless');
});

test('every storage policy gates on the audit id in the first path segment', () => {
  // This is what makes a crafted path fail at the database rather than relying
  // on the console to build a good one.
  const sql = statements(read('2026-09-09-phase60-photo-storage.sql')).toLowerCase();
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\]/);
  assert.match(sql, /a\.auditor_id = auth\.uid\(\)/);
  // Every policy is scoped to this bucket, so none can reach another one.
  const policies = sql.match(/create policy[^;]+;/g) || [];
  assert.equal(policies.length, 3, 'three storage policies');
  for (const p of policies) {
    assert.match(p, /bucket_id = 'audit-evidence'/, 'every policy names the bucket');
    assert.match(p, /to authenticated/, 'and none is granted to anon');
  }
});

test('neither Phase 6.0 migration backfills or touches a historical audit', () => {
  for (const file of ['2026-09-09-phase60-photo-evidence.sql', '2026-09-09-phase60-photo-storage.sql']) {
    const raw = read(file).toLowerCase();
    // Comments included: a commented backfill is the thing that gets pasted.
    assert.equal(/update\s+public\.audits/.test(raw), false, file);
    assert.equal(/update\s+public\.audit_items/.test(raw), false, file);
    assert.equal(/delete\s+from\s+public\.audits/.test(raw), false, file);
    assert.equal(/delete\s+from\s+public\.audit_items/.test(raw), false, file);
    assert.equal(/deletes+froms+public.properties/.test(raw), false, file);
  }
});
