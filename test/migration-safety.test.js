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
const STORAGE_MIGRATIONS = ['2026-09-09-phase60-photo-storage.sql', '2026-09-09-phase61-owner-admin-storage.sql'];
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

// Phase 6.7's public_token column is the one deliberate exception: a public
// access token has no meaningful null state, unlike every forensic/basis
// column the other migrations add for rows that predate them. Carved out
// here the same way storage migrations are carved out of the no-write rule
// above, rather than weakening the rule itself.
const DEFAULT_COLUMN_MIGRATIONS = ['2026-09-10-phase67-public-report-security.sql'];

test('every column added is nullable with no default', () => {
  for (const file of files) {
    if (DEFAULT_COLUMN_MIGRATIONS.includes(file)) continue;
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

// ── Phase 6.1: the owner role gets the reach it already implies ─────────────

test('the owner migration adds a function and policies, and alters nothing', () => {
  const file = '2026-09-09-phase61-owner-admin-access.sql';
  assert.ok(files.includes(file), `${file} is missing`);
  const sql = statements(read(file)).toLowerCase();

  assert.match(sql, /create or replace function private\.is_owner\(\)/);
  assert.match(sql, /current_auditor_role\(\) = 'owner'/);
  // Four tables, four permissive policies, nothing else.
  assert.equal((sql.match(/create policy/g) || []).length, 4);
  for (const t of ['public.audits', 'public.audit_items', 'public.audit_item_photos', 'public.properties']) {
    assert.ok(sql.includes(`on ${t}`), `${t} is not covered`);
  }
  assert.equal(/alter table/.test(sql), false, 'no table is altered');
});

test('the owner migration drops no existing policy', () => {
  // Editing the four "manages own" policies in place would mean dropping and
  // recreating them, leaving a window governed by something unreviewed.
  const sql = statements(read('2026-09-09-phase61-owner-admin-access.sql')).toLowerCase();
  assert.equal(/drop policy/.test(sql), false);
  assert.equal(/drop function/.test(sql), false);
});

test('the owner migration grants a reviewer nothing', () => {
  // Read-only must survive an administrative tier being added above it.
  const sql = statements(read('2026-09-09-phase61-owner-admin-access.sql')).toLowerCase();
  assert.equal(/is_reviewer/.test(sql), false, 'it must not mention the reviewer at all');
  assert.equal(/to anon/.test(sql), false);
});

test('the owner migration promotes nobody', () => {
  // Granting the role is a one-row decision and must never be a side effect of
  // a schema change. The migration-wide no-UPDATE rule already enforces this;
  // this says why out loud.
  const raw = read('2026-09-09-phase61-owner-admin-access.sql').toLowerCase();
  assert.equal(/update\s+public\.auditors/.test(raw), false, 'even in a comment');
  assert.equal(/insert\s+into\s+public\.auditors/.test(raw), false);
  assert.match(raw, /separate, explicit, one-row decision/, 'and records that it is deliberate');
});

test('no migration hardcodes an email address as an authorization check', () => {
  // The role model already had the right shape. Nothing may key on identity.
  for (const file of files) {
    const sql = statements(read(file)).toLowerCase();
    assert.equal(/@speculaone\.com/.test(sql), false, `${file} hardcodes an email`);
    assert.equal(/@gmail\.com/.test(sql), false, `${file} hardcodes an email`);
  }
});

test('the owner storage migration adds one policy, scoped and authenticated', () => {
  const file = '2026-09-09-phase61-owner-admin-storage.sql';
  assert.ok(files.includes(file), `${file} is missing`);
  assert.ok(STORAGE_MIGRATIONS.includes(file), 'and is declared a storage migration');
  const sql = statements(read(file)).toLowerCase();

  assert.equal((sql.match(/create policy/g) || []).length, 1);
  assert.match(sql, /bucket_id = 'audit-evidence'/);
  assert.match(sql, /to authenticated/);
  assert.match(sql, /private\.is_owner\(\)/);
  assert.equal(/insert\s+into/.test(sql), false, 'it creates no bucket');
  assert.equal(/to anon/.test(sql), false);
});

// ── Phase 6.2: the photo caption column ─────────────────────────────────────

test('the photo note migration adds exactly one nullable column', () => {
  const file = '2026-09-09-phase62-photo-notes.sql';
  assert.ok(files.includes(file), `${file} is missing`);
  const sql = statements(read(file));

  assert.match(sql, /add column if not exists\s+note\s+text/i);
  assert.equal((sql.match(/add column/gi) || []).length, 1, 'exactly one column');
  assert.equal(/not null/i.test(sql), false);
  assert.equal(/default/i.test(sql), false, 'a caption has no sensible default');
  // It must touch nothing but the photo table.
  assert.equal(/alter table public\.audits\b/i.test(sql), false);
  assert.equal(/alter table public\.audit_items\b/i.test(sql), false);
});

test('the photo note migration records that Not Assessed needs no column', () => {
  // The investigation's finding, written down where the next person will look:
  // na_reason already carries not_observed and na_note has existed unused
  // since Phase 4B, so the second half of the phase is naming, not schema.
  const raw = read('2026-09-09-phase62-photo-notes.sql');
  assert.match(raw, /not_observed/);
  assert.match(raw, /na_note/);
  assert.match(raw, /adds no column for the Not Assessed work/i);
});

// ── Phase 6.7: the public report security boundary ──────────────────────────
//
// These are text-level checks of the SQL itself, the same discipline every
// migration in this file is held to — this repository has no live-database
// test harness for RLS/grants, so the equivalent of a security regression
// test here is proving the migration text does what it claims, byte for
// byte, before it is ever applied. The REST-level checks in this file's
// VERIFICATION section (run with the anon key, against the real project,
// after applying) are what actually prove the grants behave as intended;
// these tests prove the statements that will produce that behaviour are the
// ones actually in the file.

const P67 = '2026-09-10-phase67-public-report-security.sql';
const p67sql = () => statements(read(P67)).toLowerCase();

test('the public report security migration exists', () => {
  assert.ok(files.includes(P67), `${P67} is missing`);
});

// 1, 13, 14 — anon cannot read internal audit columns (identity, commercial),
// while still reading the ones report.js's real query proves it needs —
// date, auditor_summary and critical_failures are not internal: they are the
// same content publishedResult.js already freezes into published_result.
test('anon loses table-wide SELECT on audits and is granted back an exact, verified-compatible column list', () => {
  const sql = p67sql();
  assert.match(sql, /revoke select on public\.audits from anon;/);
  const grantLine = sql.match(/grant select \(([^)]*)\) on public\.audits to anon;/)[1];
  const columns = grantLine.split(',').map((c) => c.trim()).sort();
  assert.deepEqual(columns, [
    'id', 'ref', 'date', 'status', 'tier', 'auditor_summary', 'critical_failures',
    'published_result', 'property_id', 'public_token',
  ].sort());
  // Every internal/commercial/identity column the investigation found
  // exposed must be provably absent from the granted list, not merely
  // unmentioned — matched against the exact grant statement, not the whole
  // file, so a column named only in prose cannot make this test pass by
  // accident.
  for (const col of [
    'price_quoted', 'currency', 'opportunity_id', 'auditor_id',
    'property_category', 'facility_profile', 'scope_sections', 'checklist_items',
    'focus_area', 'start_date', 'end_date', 'created_at', 'updated_at',
  ]) {
    assert.equal(grantLine.includes(col), false, `${col} must not be in the anon grant list`);
  }
});

// 3, 7, 11 — anon can retrieve exactly what report.js's real, current query
// (read directly from speculaone-web, not inferred from ROLLOUT.md alone)
// requests, so old published links — including the legacy, no-payload one —
// keep resolving exactly as they do today.
test('the audits grant matches report.js\'s real query exactly, embed column included', () => {
  const raw = read(P67);
  assert.match(raw, /id, ref, date, status, tier, auditor_summary, critical_failures/);
  assert.match(raw, /published_result, property_id, public_token/);
  assert.match(raw, /properties\(name, city, country, category\)/, 'the embed this grant supports must be documented');
});

// 2, 12 — anon cannot read internal audit_item fields (auditor notes, flags,
// critical marks, photo references), while the one real, load-bearing
// dependency — the legacy no-payload fallback for AHP-2026-8B10 — still works.
test('anon\'s audit_items grant is narrowed to exactly the legacy-fallback columns, not removed entirely', () => {
  const sql = p67sql();
  assert.match(sql, /revoke select on public\.audit_items from anon;/);
  const grantLine = sql.match(/grant select \(([^)]*)\) on public\.audit_items to anon;/)[1];
  const columns = grantLine.split(',').map((c) => c.trim()).sort();
  assert.deepEqual(columns, ['audit_id', 'item_id', 'section_id', 'status'].sort());
  for (const col of ['note', 'flag', 'critical', 'photo', 'na_reason', 'na_note']) {
    assert.equal(grantLine.includes(col), false, `${col} is auditor-written content and must not be in the grant`);
  }
});

// 3 — anon cannot read properties broadly, but the embed's four confirmed
// columns remain available — "unless a verified public report dependency
// exists" is exactly the case here, confirmed by reading report.js.
test('anon\'s properties grant is narrowed to exactly the embed\'s four columns, not removed entirely', () => {
  const sql = p67sql();
  assert.match(sql, /revoke select on public\.properties from anon;/);
  const grantLine = sql.match(/grant select \(([^)]*)\) on public\.properties to anon;/)[1];
  const columns = grantLine.split(',').map((c) => c.trim()).sort();
  assert.deepEqual(columns, ['id', 'name', 'city', 'country', 'category'].sort());
  for (const col of ['chain', 'room_count', 'has_pool', 'has_spa', 'notes', 'created_by', 'hotel_group_id']) {
    assert.equal(grantLine.includes(col), false, `${col} is an operational/facility field and must not be in the grant`);
  }
});

test('the migration records the corrected compatibility finding, and names the draft it replaces', () => {
  const raw = read(P67);
  assert.match(raw, /Nine columns, not five/);
  assert.match(raw, /taken every\s*\n?-- public report offline/i);
  assert.match(raw, /earlier draft of this migration made exactly that mistake/);
});

// 15 — photo evidence stays inaccessible; 17 — no secret is granted to make it so.
test('anon loses every privilege on audit_item_photos, and none is granted back', () => {
  const sql = p67sql();
  assert.match(sql, /revoke select, insert, update, delete on public\.audit_item_photos from anon;/);
  assert.equal(/grant[^;]*on public\.audit_item_photos to anon/.test(sql), false);
});

// 4, 5, 8, 9, 10 — unpublished audits stay hidden, and every role's access
// not routed through anon is untouched, because no policy is touched at all.
test('the migration drops or edits no existing policy, and grants nothing to authenticated', () => {
  const sql = p67sql();
  assert.equal(/drop policy/.test(sql), false);
  assert.equal(/alter policy/.test(sql), false);
  assert.equal(/create policy/.test(sql), false, 'row visibility is unchanged; only column grants move');
  assert.equal(/to authenticated/.test(sql), false, 'authenticated — internal, reviewer, owner — must be untouched');
  assert.equal(/is_owner|is_reviewer|is_internal/.test(sql), false, 'no role-check function is referenced at all');
});

// 6 — the identifier itself: public_token exists, is a real UUID, has real
// (CSPRNG-backed) entropy, and is additive rather than a replacement for ref.
test('public_token is added as a non-null, cryptographically random UUID', () => {
  const sql = p67sql();
  assert.match(sql, /add column if not exists\s+public_token\s+uuid\s+not null\s+default\s+gen_random_uuid\(\)/);
  assert.match(sql, /create unique index if not exists audits_public_token_key on public\.audits \(public_token\)/);
});

test('the migration is deliberately exempt from the no-default rule, and says why', () => {
  // Comment prose wraps across lines, each carrying its own "-- " marker,
  // and shifts with any edit — strip the markers and flatten to one line
  // before matching, rather than pinning to exact line breaks.
  const flat = read(P67).split('\n').map((l) => l.replace(/^--\s?/, '')).join(' ').replace(/\s+/g, ' ');
  assert.match(flat, /no meaningful null state/i);
  assert.match(flat, /NOT NULL DEFAULT is used deliberately, the opposite choice/);
});

// 7 — backward compatibility: ref is never touched.
test('ref is never dropped, renamed or regenerated by this migration', () => {
  const sql = p67sql();
  assert.equal(sql.includes('drop column'), false);
  assert.equal(sql.includes('rename'), false);
  assert.equal(/update\s+public\.audits\s+set\s+ref/.test(sql), false);
  const raw = read(P67).toLowerCase();
  assert.match(raw, /ref is not renamed, not dropped, not regenerated/);
});

test('the migration records the exact query it was scoped against, read from speculaone-web itself', () => {
  // The empirical basis for the whole file — if this ever stops being true,
  // the grant list above needs re-deriving, not just re-trusting. Names
  // ROLLOUT.md as the earlier, incomplete source specifically so the next
  // reader does not repeat the mistake of stopping there.
  const raw = read(P67);
  assert.match(raw, /select\('id, ref, date, status, tier, auditor_summary/);
  assert.match(raw, /properties\(name, city, country, category\)/);
  assert.match(raw, /ROLLOUT\.md/);
  assert.match(raw, /records two queries from when Phase 5\.5 shipped/);
});

test('the migration documents that speculaone-web is not modified by it', () => {
  const raw = read(P67).toLowerCase();
  assert.match(raw, /it does not change speculaone-web/);
});

test('the migration is transactional and idempotent, like every other file here', () => {
  const sql = p67sql();
  assert.ok(sql.includes('begin;'));
  assert.ok(sql.includes('commit;'));
  const adds = (sql.match(/add column/g) || []).length;
  const guarded = (sql.match(/add column if not exists/g) || []).length;
  assert.equal(adds, guarded);
});

test('the migration writes no row — no insert, update, delete or truncate anywhere, comments included', () => {
  // Deliberately checks the raw text, not just executable statements: the
  // whole point of the earlier backfill test in this file is that a
  // commented-out write is still the thing that gets pasted later.
  const raw = read(P67).toLowerCase();
  for (const verb of ['insert into', 'update public.', 'delete from', 'truncate ']) {
    assert.equal(raw.includes(verb), false, `${P67} must not contain "${verb}", even in a comment`);
  }
});

// ── Phase 7.2: one function in front of the public report ───────────────────
//
// Same discipline as Phase 6.7: the text of the SQL is proved here, and the
// anon REST requests in each file's VERIFICATION section prove the behaviour
// once applied. 7.2a adds the function and grants nothing on any table; 7.2b
// removes anon's direct SELECT on exactly three tables and touches nothing else.

const P72A = '2026-09-11-phase72a-public-report-function.sql';
const P72B = '2026-09-11-phase72b-revoke-direct-report-access.sql';
const p72a = () => statements(read(P72A)).toLowerCase();
const p72b = () => statements(read(P72B)).toLowerCase();
const fnBody = () => p72a().match(/as \$\$([\s\S]*?)\$\$;/)[1];

test('both Phase 7.2 migrations exist', () => {
  assert.ok(files.includes(P72A), `${P72A} is missing`);
  assert.ok(files.includes(P72B), `${P72B} is missing`);
});

test('the report function is security definer with an empty search_path, read-only, and plain SQL', () => {
  const sql = p72a();
  assert.match(sql, /create or replace function public\.get_public_report\(p_token uuid default null, p_ref text default null\)/);
  assert.match(sql, /returns jsonb\s+language sql\s+stable\s+security definer\s+set search_path = ''/);
  assert.equal(/plpgsql|format\(|execute\s+'|quote_ident|quote_literal/.test(sql), false, 'no dynamic SQL of any kind');
  assert.equal(/volatile/.test(sql), false);
});

test('every relation in the function is schema-qualified, since the search_path is empty', () => {
  const body = fnBody();
  const relations = [...body.matchAll(/\bfrom\s+([a-z_.]+)/g)].map((m) => m[1]).filter((r) => r !== 'target');
  assert.deepEqual([...new Set(relations)].sort(), ['public.audit_items', 'public.audits', 'public.properties']);
});

test('the lookup is one published audit by exact token, or by exact ref only when there is no token', () => {
  const body = fnBody();
  assert.match(body, /where a\.status = 'published'/);
  assert.match(body, /\(p_token is not null and a\.public_token = p_token\)/);
  assert.match(body, /\(p_token is null and nullif\(p_ref, ''\) is not null and a\.ref = p_ref\)/);
  assert.match(body, /limit 1/);
  assert.equal(/\blike\b|\bilike\b|similar to|~\*?\s|lower\(|upper\(|trim\(/.test(body), false, 'no pattern or loosened match');
});

test('the function builds its shape explicitly, and never returns an internal id or the token', () => {
  const body = fnBody();
  assert.equal(/select \*|\.\*/.test(body), false, 'no select *');
  const keys = [...body.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), [
    'auditor_summary', 'category', 'city', 'country', 'critical_failures', 'date',
    'item_id', 'items', 'name', 'properties', 'published_result', 'ref', 'section_id', 'status', 'tier',
  ]);
  for (const hidden of ['id', 'audit_id', 'property_id', 'public_token', 'auditor_id', 'note', 'na_note', 'na_reason']) {
    assert.equal(keys.includes(hidden), false, `${hidden} must not be in the envelope`);
  }
});

test('items, the property row and the raw summary are returned only for a report with no payload', () => {
  const body = fnBody();
  for (const key of ['auditor_summary', 'critical_failures', 'properties', 'items']) {
    assert.match(body, new RegExp(`'${key}',\\s+case when t\\.published_result is null then`), `${key} is legacy-only`);
  }
});

test('the function is executable by anon and authenticated only, and 7.2a grants nothing on any table', () => {
  const sql = p72a();
  assert.match(sql, /revoke all on function public\.get_public_report\(uuid, text\) from public;/);
  assert.match(sql, /grant execute on function public\.get_public_report\(uuid, text\) to anon, authenticated;/);
  assert.equal((sql.match(/\bgrant\b/g) || []).length, 1, 'one grant, the execute');
  assert.equal(/\bon public\.[a-z_]+ (to|from)\b/.test(sql), false, 'no table privilege changes');
  assert.equal(/create policy|alter policy|drop policy|row level security/.test(sql), false);
});

test('7.2b revokes SELECT from anon on exactly audits, audit_items and properties', () => {
  const sql = p72b();
  const revokes = sql.match(/revoke[^;]*;/g) || [];
  assert.deepEqual(revokes.map((r) => r.replace(/\s+/g, ' ')), [
    'revoke select on public.audits from anon;',
    'revoke select on public.audit_items from anon;',
    'revoke select on public.properties from anon;',
  ]);
  assert.equal(/\bgrant\b/.test(sql), false, 'it grants nothing');
  assert.equal(/create policy|alter policy|drop policy|row level security|function/.test(sql), false);
  for (const other of ['activity_log', 'auditors', 'communications', 'contacts', 'documents', 'expenses',
    'hotel_groups', 'invoices', 'leads', 'opportunities', 'tasks', 'audit_item_photos', 'authenticated']) {
    assert.equal(new RegExp(`\\b${other}\\b`).test(sql), false, `${other} is outside Phase 7.2`);
  }
});

test('7.2b states the order it depends on and why direct access goes', () => {
  const raw = read(P72B);
  assert.match(raw, /PRECONDITION: apply ONLY after/);
  assert.match(raw, /every public report goes offline/);
  assert.match(raw, /A row policy cannot require a request to name one specific row/);
  assert.match(raw, /leads \(its public INSERT policy\s*\n?--\s*stays exactly as it is\)/);
});

test('7.2b documents a rollback that restores exactly the Phase 6.7 column grants', () => {
  const cols = (text, table) => text.match(new RegExp(`grant select \\(([^)]*)\\) on public\\.${table} to anon;`))[1]
    .split(',').map((c) => c.trim()).sort();
  const rollback = read(P72B).toLowerCase().replace(/\n--\s*/g, ' ');
  for (const table of ['audits', 'audit_items', 'properties']) {
    assert.deepEqual(cols(rollback, table), cols(p67sql(), table), `${table} rollback matches 6.7`);
  }
});

test('neither Phase 7.2 migration writes, drops or regenerates anything', () => {
  for (const file of [P72A, P72B]) {
    const raw = read(file).toLowerCase();
    for (const verb of ['insert into', 'update public.', 'delete from', 'truncate ', 'drop table', 'alter table', 'gen_random_uuid']) {
      assert.equal(raw.includes(verb), false, `${file} must not contain "${verb}"`);
    }
  }
});
