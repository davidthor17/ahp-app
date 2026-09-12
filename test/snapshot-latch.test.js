// Phase 7.3A — the basis a new audit records, and the latch that stopped it.
//
// Production, 2026-09-12. A brand-new audit created on the current build showed
// the legacy acknowledgement on its finish screen: "Confirm you are publishing
// this as a legacy audit." Its row carried no basis at all, and of 89 REST
// calls in that session not one was a basis write for it.
//
// The cause was not the snapshot logic, which is correct, and not the remote
// pull, which preserves a frozen local snapshot through pickSnapshot. It was a
// ref:
//
//   persistSnapshot returns early when writeSettledRef.current is true.
//   writeSettledRef is set whenever a lock write matches no row — another
//   session got there first, or the audit has been deleted. It belongs to one
//   audit, but it lives on the tab.
//
// resumeAudit has always cleared it. startNewAudit, added in Phase 7.3, did
// not. So a tab that had touched a deleted audit could never record a basis for
// any audit started afterwards: each one froze locally, published against the
// live property, and carried a permanent line saying its basis was never
// recorded.
//
// These tests model the three App.jsx moments — the first-grade freeze, the
// remote pull, and persistSnapshot with its conditional write — against the
// real framework functions, so the rules cannot drift from the code they pin.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSnapshot, snapshotFromRow, snapshotToRow, pickSnapshot, classifyLoadedAudit,
  canFreeze, shouldPersistSnapshot, isUsableSnapshot, resolveScoringProfile,
  isUnfrozenStatus, SNAPSHOT_STATUS, SNAPSHOT_COLUMNS,
} from '../src/framework/snapshot.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');

const PROP = { name: 'Hotel Under Test', city: 'Reykjavik', category: '4★', hasRestaurant: true, hasPool: false, hasSpa: false };
const GRADED = { 'PRE-01': { morning: { status: 'met' } } };

/** One tab. rowSnapshotRef and writeSettledRef are refs on the component. */
const tab = (over = {}) => ({
  session: true, readOnly: false, auditId: 'audit-a',
  snapshot: null, snapshotStatus: SNAPSHOT_STATUS.NONE, audit: {},
  rowSnapshotRef: null, writeSettledRef: false, ...over,
});

/** adoptAudit, App.jsx ~302. */
function adoptAudit(t, nextAudit, nextSnapshot) {
  t.snapshotStatus = classifyLoadedAudit(nextSnapshot, nextAudit);
  t.snapshot = nextSnapshot || null;
  t.audit = nextAudit || {};
  return t;
}

/** The first-grade lock effect, App.jsx ~2035. */
function freezeEffect(t, { tier = 'full' } = {}) {
  if (t.snapshot || !canFreeze(t.snapshotStatus)) return { froze: false };
  const started = Object.values(t.audit).some((s) => Object.values(s || {}).some((e) => e && e.status));
  if (!started || !PROP.name) return { froze: false };
  t.snapshot = buildSnapshot(PROP, { auditType: tier, lockedAt: '2026-09-12T12:00:00.000Z' });
  t.snapshotStatus = SNAPSHOT_STATUS.FROZEN;
  return { froze: true };
}

/** The remote pull, App.jsx 757-782. */
function remotePull(t, { auditRow, items = [] }) {
  const rowSnapshot = snapshotFromRow(auditRow);
  const picked = pickSnapshot(rowSnapshot, t.snapshot);
  t.rowSnapshotRef = rowSnapshot;
  if (items.length) adoptAudit(t, items, picked.snapshot);
  else if (picked.snapshot !== t.snapshot) adoptAudit(t, t.audit, picked.snapshot);
  return t;
}

/**
 * persistSnapshot, App.jsx ~1999, guards and conditional write.
 * The write is `.eq('id', auditId).is('snapshot_locked_at', null).maybeSingle()`,
 * so a deleted row and a row somebody else locked both come back as no row.
 */
function persistSnapshot(t, db) {
  if (!t.session || t.readOnly || !t.auditId) return { attempted: false, wrote: false, why: 'no session or audit' };
  if (t.writeSettledRef) return { attempted: false, wrote: false, why: 'writeSettledRef latched true' };
  if (!shouldPersistSnapshot(t.snapshot, t.rowSnapshotRef)) return { attempted: false, wrote: false, why: 'shouldPersistSnapshot false' };
  const patch = snapshotToRow(t.snapshot);
  if (!patch) return { attempted: false, wrote: false, why: 'snapshotToRow null' };
  const row = db[t.auditId];
  let data = null;
  if (row && row.snapshot_locked_at === null) { Object.assign(row, patch); data = { snapshot_locked_at: patch.snapshot_locked_at }; }
  t.rowSnapshotRef = data ? t.snapshot : t.rowSnapshotRef;
  if (!data) t.writeSettledRef = true;
  return { attempted: true, wrote: Boolean(data), patch };
}

/** startNewAudit, App.jsx ~852, with the Phase 7.3A resets. */
function startNewAudit(t, auditId) {
  t.auditId = auditId;
  t.rowSnapshotRef = null;
  t.writeSettledRef = false;
  adoptAudit(t, {}, null);
  return t;
}

/** resumeAudit, App.jsx ~603-608. */
function resumeAudit(t, auditId, row, graded) {
  t.auditId = auditId;
  t.rowSnapshotRef = snapshotFromRow(row);
  t.writeSettledRef = false;
  adoptAudit(t, graded, t.rowSnapshotRef);
  return t;
}

const emptyRow = (id) => ({ id, tier: 'full', status: 'draft', snapshot_locked_at: null, property_category: null, facility_profile: null });
const needsLegacyAck = (t) => {
  const basis = resolveScoringProfile(t.snapshot, PROP, t.snapshotStatus);
  return !basis.frozen && isUnfrozenStatus(t.snapshotStatus) && t.snapshotStatus !== SNAPSHOT_STATUS.NONE;
};

// ── A ───────────────────────────────────────────────────────────────────────

test('A. a frozen local snapshot survives a pull whose row carries no basis', () => {
  // The hypothesis this rules out: that the pull downgraded a fresh basis.
  // pickSnapshot falls back to the local snapshot, so the branch never fires.
  const t = tab({ audit: GRADED });
  freezeEffect(t);
  const before = t.snapshot;

  remotePull(t, { auditRow: emptyRow('audit-a'), items: [] });

  assert.equal(t.snapshot, before, 'the same snapshot object, untouched');
  assert.equal(t.snapshotStatus, SNAPSHOT_STATUS.FROZEN);
  assert.equal(isUsableSnapshot(t.snapshot), true);
  assert.equal(needsLegacyAck(t), false, 'and no acknowledgement is asked for');
});

// ── B ───────────────────────────────────────────────────────────────────────

test('B. with the latch clear, a frozen snapshot is actually written to the row', () => {
  const db = { 'audit-a': emptyRow('audit-a') };
  const t = tab({ audit: GRADED });
  freezeEffect(t);

  const result = persistSnapshot(t, db);
  assert.equal(result.attempted, true);
  assert.equal(result.wrote, true);
  assert.equal(db['audit-a'].snapshot_locked_at, '2026-09-12T12:00:00.000Z');
  assert.equal(db['audit-a'].property_category, '4★');
  assert.ok(db['audit-a'].checklist_items.length > 0, 'the pin travels with it');
  assert.equal(t.writeSettledRef, false, 'a successful write settles nothing');
});

// ── B2, the defect this phase exists for ────────────────────────────────────

test('B2. a lock write that matched no row must not disable the NEXT audit', () => {
  // Audit A has been deleted while this device still holds its id: exactly the
  // production sequence. The write matches nothing and latches the ref.
  const db = { 'audit-b': emptyRow('audit-b') };            // audit-a is gone
  const t = tab({ auditId: 'audit-a', audit: GRADED });
  freezeEffect(t);
  const deadWrite = persistSnapshot(t, db);
  assert.equal(deadWrite.attempted, true);
  assert.equal(deadWrite.wrote, false, 'there was no row to write to');
  assert.equal(t.writeSettledRef, true, 'and the latch is set');

  // The auditor starts the next hotel's audit in the same tab.
  startNewAudit(t, 'audit-b');
  assert.equal(t.writeSettledRef, false, 'the latch belongs to the audit that is gone');
  assert.equal(t.rowSnapshotRef, null, 'and so does the row basis it was compared against');

  t.audit = GRADED;
  assert.equal(freezeEffect(t).froze, true, 'the new audit freezes its own basis');
  const write = persistSnapshot(t, db);
  assert.equal(write.attempted, true, 'and the write is attempted, not skipped');
  assert.equal(write.wrote, true);
  assert.equal(db['audit-b'].snapshot_locked_at, '2026-09-12T12:00:00.000Z');

  // What the next session sees. Before the fix this read legacy-unfrozen.
  const later = tab({ auditId: null });
  resumeAudit(later, 'audit-b', db['audit-b'], GRADED);
  assert.equal(later.snapshotStatus, SNAPSHOT_STATUS.FROZEN);
  assert.equal(needsLegacyAck(later), false, 'no acknowledgement, because a basis was recorded');
});

test('B2b. the defect, reproduced: leaving the latch set loses the basis for good', () => {
  const db = { 'audit-b': emptyRow('audit-b') };
  const t = tab({ auditId: 'audit-a', audit: GRADED });
  freezeEffect(t);
  persistSnapshot(t, db);                                   // latches

  // startNewAudit WITHOUT the resets, as Phase 7.3 shipped it.
  t.auditId = 'audit-b';
  adoptAudit(t, {}, null);
  t.audit = GRADED;
  freezeEffect(t);

  const write = persistSnapshot(t, db);
  assert.equal(write.attempted, false, 'the write never goes out');
  assert.equal(write.why, 'writeSettledRef latched true');
  assert.equal(db['audit-b'].snapshot_locked_at, null, 'the row keeps no basis');

  const later = tab({ auditId: null });
  resumeAudit(later, 'audit-b', db['audit-b'], GRADED);
  assert.equal(later.snapshotStatus, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(needsLegacyAck(later), true, 'and the audit is legacy for ever, which is what production showed');
});

// ── C ───────────────────────────────────────────────────────────────────────

test('C. a persisted basis survives a later pull and is never rewritten', () => {
  const db = { 'audit-a': emptyRow('audit-a') };
  const t = tab({ audit: GRADED });
  freezeEffect(t);
  persistSnapshot(t, db);
  const written = { ...db['audit-a'] };

  remotePull(t, { auditRow: db['audit-a'], items: [] });
  assert.equal(t.snapshotStatus, SNAPSHOT_STATUS.FROZEN);

  const second = persistSnapshot(t, db);
  assert.equal(second.attempted, false, 'nothing to do: the row already holds it');
  assert.equal(second.why, 'shouldPersistSnapshot false');
  assert.deepEqual(db['audit-a'], written, 'the recorded basis is byte-identical afterwards');
});

// ── D ───────────────────────────────────────────────────────────────────────

test('D. a genuinely legacy audit stays legacy, latch clear or not', () => {
  const db = { 'legacy-1': emptyRow('legacy-1') };
  const t = tab({ auditId: null });
  resumeAudit(t, 'legacy-1', db['legacy-1'], GRADED);       // grades, no basis anywhere

  assert.equal(t.writeSettledRef, false, 'the latch is clear, so this is not what protects it');
  assert.equal(t.snapshotStatus, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(freezeEffect(t).froze, false, 'it may never freeze');
  assert.equal(canFreeze(t.snapshotStatus), false);
  assert.equal(persistSnapshot(t, db).attempted, false);
  assert.equal(db['legacy-1'].snapshot_locked_at, null, 'and nothing is invented for it');
  assert.equal(needsLegacyAck(t), true, 'the acknowledgement is correct here, and only here');
});

// ── E ───────────────────────────────────────────────────────────────────────

test('E. a basis write touches only the basis columns, never the published report', () => {
  const snapshot = buildSnapshot(PROP, { auditType: 'full', lockedAt: '2026-09-12T12:00:00.000Z' });
  const patch = snapshotToRow(snapshot);
  assert.deepEqual(Object.keys(patch).sort(), [...SNAPSHOT_COLUMNS].sort());
  for (const forbidden of ['published_result', 'status', 'auditor_summary', 'critical_failures', 'ref', 'public_token']) {
    assert.equal(forbidden in patch, false, `${forbidden} must never be in a basis write`);
  }
});

test('E2. the publish-once condition and the lock condition are both still in place', () => {
  assert.match(APP, /\.or\('status\.neq\.published,published_result\.is\.null'\)/, 'publish once');
  assert.match(APP, /\.is\('snapshot_locked_at', null\)/, 'a basis is written once, by whoever gets there first');
});

// ── F ───────────────────────────────────────────────────────────────────────

test('F. startNewAudit clears both basis refs, exactly as resumeAudit does', () => {
  // Sliced by length rather than by the next declaration: startNewAudit sits
  // below persistQueue, so anchoring on another name would depend on where in
  // the file it happens to be.
  const startAt = APP.indexOf('const startNewAudit');
  assert.notEqual(startAt, -1, 'startNewAudit exists');
  const start = APP.slice(startAt, startAt + 2000);
  assert.match(start, /rowSnapshotRef\.current = null;\s*\n\s*writeSettledRef\.current = false;/);

  const resume = APP.slice(APP.indexOf('const resumeAudit'), APP.indexOf('const closeReviewAudit'));
  assert.match(resume, /rowSnapshotRef\.current = rowSnapshot;/);
  assert.match(resume, /writeSettledRef\.current = false;/);

  // And they are deliberately not in the shared reset: resumeAudit calls that
  // after reading the row's basis, so clearing them there would discard it.
  const reset = APP.slice(APP.indexOf('const resetAuditScopedState'), APP.indexOf('// Watch for new builds'));
  assert.equal(/rowSnapshotRef|writeSettledRef/.test(reset), false);
});

test('F2. the rejected downgrade guard was not added', () => {
  // pickSnapshot already preserves a usable local snapshot; test A proves it.
  // A guard here would have been a fix for a bug that does not exist.
  const pull = APP.slice(APP.indexOf('const rowSnapshot = snapshotFromRow(auditRow);'), APP.indexOf('// The tier the row already carries'));
  assert.match(pull, /else if \(picked\.snapshot !== snapshotRef\.current\)/, 'the branch is unchanged');
  assert.equal(/isUsableSnapshot\(picked\.snapshot\)/.test(pull), false);
});
