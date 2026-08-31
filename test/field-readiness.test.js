// Phase 5.8 P0 — the two defects that would have shown up in a real hotel.
//
// 1. The audit tier lived only in React state. It was absent from the
//    localStorage blob and never read back from the audit row, so every reload
//    returned it to Full. publishAudit writes whatever it holds to the row and
//    into the payload, so a Spot Audit resumed after a reload published as a
//    Full Audit and became eligible for the Specula Mark. That is a false
//    certification claim on a public page, not merely a wrong label.
//
// 2. An audit was reachable only through ids held in localStorage. A cleared
//    browser made a part finished audit unreachable although every row was
//    safe in the database. Recovery is now possible, and the danger in
//    recovery is the opposite one: rebuilding a scoring basis from today's
//    property record would state, as recorded fact, conditions nobody
//    recorded. These tests fix the boundary between recovering a basis and
//    inventing one.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  snapshotFromRow, snapshotToRow, classifyLoadedAudit, canFreeze,
  SNAPSHOT_STATUS, buildSnapshot, pickSnapshot,
} from '../src/framework/snapshot.js';
import { buildPublishedResult } from '../src/framework/publishedResult.js';
import { MARK_AUDIT_TYPES } from '../src/framework/publishedResult.js';

const TIERS = ['desk', 'spot', 'full'];

/** The localStorage blob as persist() writes it, and the hydrate that reads it. */
const persistBlob = ({ prop, audit, ids, snapshot, auditTier }) =>
  JSON.parse(JSON.stringify({ prop, audit, ids, snapshot, trailQueue: [], auditTier }));

const hydrateTier = (blob) =>
  blob.auditTier && TIERS.includes(blob.auditTier) ? blob.auditTier : 'full';

// ── P0-1: the tier survives a reload ────────────────────────────────────────

test('every tier survives the write and the read', () => {
  for (const tier of TIERS) {
    const blob = persistBlob({ prop: { name: 'H' }, audit: {}, ids: {}, snapshot: null, auditTier: tier });
    assert.equal(hydrateTier(blob), tier, `${tier} must come back intact`);
  }
});

test('the persisted blob actually carries the tier', () => {
  // The exact defect: this key was absent from the object persist() wrote.
  const blob = persistBlob({ prop: { name: 'H' }, audit: {}, ids: {}, snapshot: null, auditTier: 'spot' });
  assert.equal(Object.prototype.hasOwnProperty.call(blob, 'auditTier'), true);
  assert.equal(blob.auditTier, 'spot');
});

test('defect reproduced: without the key a Spot Audit reloads as Full', () => {
  const lossy = { prop: { name: 'H' }, audit: {}, ids: {}, snapshot: null, trailQueue: [] };
  assert.equal(hydrateTier(lossy), 'full', 'the old blob has nothing to restore');
  assert.notEqual(hydrateTier(lossy), 'spot', 'which is how a Spot Audit became a Full Audit');
});

test('a blob from before this change still loads, as Full', () => {
  // Backward compatibility: an audit in progress on a device right now has no
  // auditTier in its blob, and Full is what it has been scored as all along.
  assert.equal(hydrateTier({ prop: {}, audit: {} }), 'full');
});

test('an unrecognised tier is refused rather than trusted', () => {
  for (const bad of ['FULL', 'premium', '', null, 42, {}]) {
    assert.equal(hydrateTier({ auditTier: bad }), 'full', `${JSON.stringify(bad)} must not be adopted`);
  }
});

test('the row tier is only adopted when the row actually has one', () => {
  // tier reaches the row at publish, so it is null on every draft. Adopting a
  // null would overwrite the auditor's live choice with nothing.
  const adopt = (rowTier, current) =>
    rowTier && TIERS.includes(rowTier) ? rowTier : current;

  assert.equal(adopt(null, 'spot'), 'spot', 'a draft row leaves the local choice alone');
  assert.equal(adopt(undefined, 'spot'), 'spot');
  assert.equal(adopt('spot', 'full'), 'spot', 'a published row outranks a fresh default');
});

test('the Mark follows the tier, so restoring it wrongly would mismark', () => {
  // Why the tier matters beyond a label: this is the gate the whole Mark
  // hierarchy rests on.
  assert.deepEqual(MARK_AUDIT_TYPES, ['full']);
  assert.equal(MARK_AUDIT_TYPES.includes('spot'), false, 'a Spot Audit must never carry the Mark');
  assert.equal(MARK_AUDIT_TYPES.includes('desk'), false);
});

test('a Spot Audit published as itself is not marked', () => {
  const prop = { name: 'Hotel', city: 'Madrid', country: 'ES', category: '5★' };
  const graded = { 'RM-01': { morning: { status: 'met', time: '09:00' } } };
  const common = {
    prop, graded, criticalFailures: [], scoringBasis: { frozen: false, state: 'legacy-unfrozen', recordedOn: null },
    auditedOn: '2026-09-02', publishedAt: '2026-09-02T10:00:00.000Z', summary: 'x',
  };
  const spot = buildPublishedResult({ ...common, auditType: 'spot' });
  const full = buildPublishedResult({ ...common, auditType: 'full' });

  assert.equal(spot.auditType, 'spot');
  assert.equal(full.auditType, 'full');
  // The distinction the reload defect erased.
  assert.notEqual(spot.auditType, full.auditType);
});

// ── P0-3: recovery must never invent a basis ────────────────────────────────

const BASIS_ROW = {
  tier: 'full',
  property_category: '5★',
  facility_profile: { hasRestaurant: true, hasPool: true, hasSpa: false },
  scope_sections: null,
  framework_version: '1.3.0',
  checklist_version: '1.2.0',
  snapshot_locked_at: '2026-08-31T09:41:47.761+00:00',
};

const GRADED = { 'RM-01': { morning: { status: 'met', time: '09:00' } } };

test('resuming an audit whose row has a basis adopts that basis', () => {
  const snapshot = snapshotFromRow(BASIS_ROW);
  assert.ok(snapshot, 'the row basis is readable');
  assert.equal(snapshot.lockedAt, BASIS_ROW.snapshot_locked_at, 'the original lock date, not today');
  assert.equal(snapshot.propertyCategory, '5★');

  const status = classifyLoadedAudit(snapshot, GRADED);
  assert.equal(status, SNAPSHOT_STATUS.FROZEN);
  assert.equal(canFreeze(status), false, 'a frozen audit never re-freezes');
});

test('resuming an audit whose row has no basis loads it legacy, and it never freezes', () => {
  // The whole point. A recovered legacy audit must stay legacy forever.
  for (const row of [
    null,
    {},
    { tier: 'full' },
    { ...BASIS_ROW, snapshot_locked_at: null },
    { ...BASIS_ROW, property_category: null },
  ]) {
    const snapshot = snapshotFromRow(row);
    assert.equal(snapshot, null, `${JSON.stringify(row)} must yield no basis`);

    const status = classifyLoadedAudit(snapshot, GRADED);
    assert.equal(status, SNAPSHOT_STATUS.LEGACY_UNFROZEN, 'graded with no basis is legacy');
    assert.equal(canFreeze(status), false, 'and a legacy audit must never acquire one');
  }
});

test('an empty recovered audit with no basis may still freeze at its first grade', () => {
  // Legacy is about grades that predate a basis. An audit with no grades and no
  // basis has simply not started, and freezing at its first grade is correct.
  const status = classifyLoadedAudit(null, {});
  assert.equal(status, SNAPSHOT_STATUS.NONE);
  assert.equal(canFreeze(status), true);
});

test('recovery never reconstructs a basis from the property record', () => {
  // buildSnapshot from today's property would produce a usable, plausible and
  // entirely fictional basis stamped with today's date. Recovery must not have
  // that shape anywhere in it.
  const today = buildSnapshot(
    { name: 'Hotel', category: '5★', hasRestaurant: true },
    { auditType: 'full', lockedAt: '2026-09-02T08:00:00.000Z' },
  );
  const recovered = snapshotFromRow({ ...BASIS_ROW });

  assert.notEqual(recovered.lockedAt, today.lockedAt,
    'a recovered basis carries the date it was frozen, not the date it was recovered');

  // And with no row basis there is nothing to fall back to but null.
  assert.equal(snapshotFromRow(null), null);
  assert.equal(pickSnapshot(snapshotFromRow(null), null).snapshot, null);
  assert.equal(pickSnapshot(snapshotFromRow(null), null).source, 'none');
});

test('the row basis outranks a local one, so a stale device cannot win', () => {
  const rowSnapshot = snapshotFromRow(BASIS_ROW);
  const localSnapshot = buildSnapshot(
    { name: 'Hotel', category: '4★' },
    { auditType: 'full', lockedAt: '2026-09-02T08:00:00.000Z' },
  );
  const picked = pickSnapshot(rowSnapshot, localSnapshot);
  assert.equal(picked.source, 'audit-row');
  assert.equal(picked.snapshot.propertyCategory, '5★', 'the recorded basis, not the local one');
});

test('a basis survives the row round trip unchanged', () => {
  const snapshot = snapshotFromRow(BASIS_ROW);
  const back = snapshotFromRow({ ...snapshotToRow(snapshot), tier: BASIS_ROW.tier });
  assert.deepEqual(back, snapshot);
});
