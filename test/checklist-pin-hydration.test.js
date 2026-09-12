// Phase 7.3B — the checklist pin has to survive coming back.
//
// Found in production on 2026-09-12, on a fresh audit whose basis had just been
// written correctly. The row held 55 pinned item ids. The console resumed the
// audit, read its basis back from that row, classified it FROZEN — and the
// hydrated snapshot's checklistItems was null.
//
// The basis columns are selected by name in two places, and both listed six of
// the seven. checklist_items was added with the pin itself
// (migrations/2026-09-09-phase58-checklist-pin.sql) and neither select was
// extended, so snapshotFromRow received undefined and normalisePin answered
// null. Nothing failed and nothing was logged: the audit simply went back to
// scoring against the live catalogue, which is precisely what the pin exists to
// prevent. An item added to the catalogue after an audit began would appear in
// it on the next resume.
//
// Everything here is the real framework code. The two source assertions are in
// the style the publish and token-link suites already use: the column list is
// the defect, so the column list is what gets pinned.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSnapshot, snapshotToRow, snapshotFromRow, resolveScoringProfile,
  classifyLoadedAudit, shouldPersistSnapshot, isUsableSnapshot,
  SNAPSHOT_STATUS, SNAPSHOT_COLUMNS,
} from '../src/framework/snapshot.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');

// The property audit C was created with: 4★, no restaurant, no pool, no spa.
const PROP = {
  name: 'ZZ PHASE 7.3B DISPOSABLE TEST C', city: 'Testville', category: '4★',
  hasRestaurant: false, hasPool: false, hasSpa: false,
};
const LOCKED = '2026-09-12T12:32:06.959Z';
const frozen = () => buildSnapshot(PROP, { auditType: 'full', lockedAt: LOCKED });

/** An audits row as the two selects return it, once both carry the pin. */
const rowFor = (snapshot, over = {}) => ({
  tier: 'full', status: 'draft', published_result: null, ...snapshotToRow(snapshot), ...over,
});

// ── A ───────────────────────────────────────────────────────────────────────

test('A. a fresh audit stores its checklist pin with the rest of the basis', () => {
  const snapshot = frozen();
  assert.ok(snapshot.checklistItems.length > 0, 'the freeze records the applicable set');

  const patch = snapshotToRow(snapshot);
  assert.ok(Array.isArray(patch.checklist_items));
  assert.equal(patch.checklist_items.length, snapshot.checklistItems.length);
  assert.ok(SNAPSHOT_COLUMNS.includes('checklist_items'), 'and it is one of the seven basis columns');
});

// ── B and C: the two selects ────────────────────────────────────────────────

test('B. the resume select asks for checklist_items', () => {
  assert.match(APP, /\.select\('tier, property_category, facility_profile, scope_sections, framework_version, checklist_version, checklist_items, snapshot_locked_at, status, published_result'\)/);
});

test('C. the remote pull select asks for checklist_items', () => {
  assert.match(APP, /\.select\('tier, property_category, facility_profile, scope_sections, framework_version, checklist_version, checklist_items, snapshot_locked_at, status, published_result, public_token'\)/);
});

test('B+C. every basis column named in SNAPSHOT_COLUMNS is actually selected, in both paths', () => {
  const selects = APP.match(/\.select\('tier, property_category[^']*'\)/g) || [];
  assert.equal(selects.length, 2, 'resume and the remote pull, and nowhere else');
  for (const select of selects) {
    for (const column of SNAPSHOT_COLUMNS) {
      assert.ok(select.includes(column), `${column} is missing from ${select.slice(0, 40)}…`);
    }
  }
});

// ── D and E: the round trip ─────────────────────────────────────────────────

test('D. a hydrated snapshot carries the identical pin, id for id', () => {
  const snapshot = frozen();
  const hydrated = snapshotFromRow(rowFor(snapshot));
  assert.deepEqual(hydrated.checklistItems, snapshot.checklistItems);
  assert.equal(hydrated.propertyCategory, snapshot.propertyCategory);
  assert.equal(hydrated.frameworkVersion, snapshot.frameworkVersion);
  assert.equal(hydrated.checklistVersion, snapshot.checklistVersion);
  assert.equal(hydrated.lockedAt, LOCKED);
  assert.equal(isUsableSnapshot(hydrated), true);
});

test('E. a 55-item audit is still pinned to those 55 ids after a resume', () => {
  // The production case, with the count audit C actually froze.
  const snapshot = frozen();
  assert.equal(snapshot.checklistItems.length, 55, 'this property pins 55 items');

  const hydrated = snapshotFromRow(rowFor(snapshot));
  const basis = resolveScoringProfile(hydrated, PROP, classifyLoadedAudit(hydrated, { 'PRE-01': { morning: { status: 'met' } } }));
  assert.equal(basis.frozen, true);
  assert.equal(basis.checklistItems.length, 55);
  assert.deepEqual([...basis.checklistItems].sort(), [...snapshot.checklistItems].sort());
});

test('E2. the defect, reproduced: a row read without the column loses the pin', () => {
  // What both selects did before this phase. Nothing throws; the audit simply
  // stops being pinned and scores against the live catalogue instead.
  const snapshot = frozen();
  const { checklist_items, ...withoutTheColumn } = rowFor(snapshot);
  const hydrated = snapshotFromRow(withoutTheColumn);

  assert.equal(hydrated.checklistItems, null, 'the pin is gone');
  assert.equal(isUsableSnapshot(hydrated), true, 'while everything else still reads as a valid basis');
  const basis = resolveScoringProfile(hydrated, PROP, SNAPSHOT_STATUS.FROZEN);
  assert.equal(basis.frozen, true, 'so it is still FROZEN, which is why this was invisible');
  assert.equal(basis.checklistItems, null, 'but applicability falls back to the live catalogue');
});

// ── F ───────────────────────────────────────────────────────────────────────

test('F. an audit with no basis at all stays legacy, pin column or not', () => {
  const legacyRow = { tier: 'full', status: 'draft', snapshot_locked_at: null, property_category: null, facility_profile: null, checklist_items: null };
  assert.equal(snapshotFromRow(legacyRow), null);
  assert.equal(
    classifyLoadedAudit(null, { 'PRE-01': { morning: { status: 'met' } } }),
    SNAPSHOT_STATUS.LEGACY_UNFROZEN,
  );
  // And an audit frozen before the pin existed keeps reading the live
  // catalogue, which is the behaviour those audits have always had.
  const prePin = snapshotFromRow(rowFor(frozen(), { checklist_items: null }));
  assert.equal(prePin.checklistItems, null);
  assert.equal(isUsableSnapshot(prePin), true, 'a basis without a pin is still a basis');
});

// ── G ───────────────────────────────────────────────────────────────────────

test('G. hydrating a basis never provokes another basis write', () => {
  const snapshot = frozen();
  const hydrated = snapshotFromRow(rowFor(snapshot));
  assert.equal(shouldPersistSnapshot(snapshot, hydrated), false, 'the row already holds it');
  assert.equal(shouldPersistSnapshot(hydrated, hydrated), false);
  // Only a first freeze against a row with nothing recorded may write.
  assert.equal(shouldPersistSnapshot(snapshot, null), true);
});

// ── H ───────────────────────────────────────────────────────────────────────

test('H. a basis write still touches only the basis columns', () => {
  const patch = snapshotToRow(frozen());
  assert.deepEqual(Object.keys(patch).sort(), [...SNAPSHOT_COLUMNS].sort());
  for (const forbidden of ['published_result', 'status', 'auditor_summary', 'critical_failures', 'ref', 'public_token', 'tier']) {
    assert.equal(forbidden in patch, false, `${forbidden} must never be in a basis write`);
  }
  assert.match(APP, /\.or\('status\.neq\.published,published_result\.is\.null'\)/, 'publish once, unchanged');
  assert.match(APP, /\.is\('snapshot_locked_at', null\)/, 'a basis is written once, unchanged');
});
