// Phase 5.7 — the audit row is where a scoring basis lives.
//
// A snapshot existed only in React state and localStorage, which made it the
// one part of an audit that could not survive a lost browser profile. During
// the 5.6.2 production smoke test exactly that happened: the incognito session
// closed, the basis went with it, and the audit could only be recovered by
// hand-building a storage blob from SQL. Its findings survived in Supabase; the
// conditions it was judged under did not.
//
// The rule these tests hold to the fire: the row outranks local storage, and
// nothing is ever invented for an audit that never recorded one.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSnapshot, snapshotToRow, snapshotFromRow, pickSnapshot, shouldPersistSnapshot,
  classifyLoadedAudit, canFreeze, resolveScoringProfile, isUsableSnapshot,
  SNAPSHOT_COLUMNS, SNAPSHOT_STATUS,
} from '../src/framework/snapshot.js';
import { applicableItems } from '../src/framework/catalog.js';
import { FRAMEWORK_VERSION, CHECKLIST_VERSION } from '../src/framework/version.js';
import { AUDIT_TYPE } from '../src/framework/weights.js';

const PROP = {
  name: 'Hotel Borealis', category: '5★',
  hasRestaurant: true, hasPool: true, hasSpa: true,
  hasSauna: null, hasChangingRooms: null, hasMinibar: true,
  hasLunchService: null, hasGym: false,
};
const LOCKED_AT = '2026-09-01T09:15:00.000Z';
const FULL = { auditType: AUDIT_TYPE.FULL, lockedAt: LOCKED_AT };
const GRADES = { 'RM-01': { day: { status: 'met' } } };

const frozen = () => buildSnapshot(PROP, FULL);
/** What Supabase would hand back for a row written by snapshotToRow. */
const asRow = (snapshot, tier = 'full') => ({ tier, ...snapshotToRow(snapshot) });

// ── the round trip ──────────────────────────────────────────────────────────

test('a frozen basis survives the round trip through the audit row', () => {
  const before = frozen();
  const after = snapshotFromRow(asRow(before));

  assert.deepEqual(after.facilityProfile, before.facilityProfile);
  assert.equal(after.propertyCategory, '5★');
  assert.equal(after.lockedAt, LOCKED_AT);
  assert.equal(after.frameworkVersion, FRAMEWORK_VERSION);
  assert.equal(after.checklistVersion, CHECKLIST_VERSION);
  assert.equal(after.auditType, 'full');
  assert.equal(isUsableSnapshot(after), true);
});

test('the round trip selects exactly the same items', () => {
  const before = frozen();
  const after = snapshotFromRow(asRow(before));
  const ids = (s) => applicableItems(resolveScoringProfile(s, {}).profile).map((i) => i.id);
  assert.deepEqual(ids(after), ids(before));
  // 130: 5★ with every facility is 133, and hasGym false removes three.
  assert.equal(ids(after).length, 130);
});

test('a three-state flag keeps all three states through the row', () => {
  const p = snapshotToRow(frozen()).facility_profile;
  assert.equal(p.hasGym, false, 'a recorded absence persists as false');
  assert.equal(p.hasMinibar, true, 'a recorded presence persists as true');
  // buildSnapshot resolves unknown to present before the row ever sees it, so
  // the row stores what the audit was actually scored against.
  assert.equal(p.hasSauna, true, 'unknown was frozen as present, and stays present');
  assert.equal(p.hasLunchService, true);
});

test('snapshotToRow writes exactly the six columns and nothing else', () => {
  const row = snapshotToRow(frozen());
  assert.deepEqual(Object.keys(row).sort(), [...SNAPSHOT_COLUMNS].sort());
  assert.equal(SNAPSHOT_COLUMNS.length, 6);
});

test('a Spot scope travels with the basis', () => {
  const spot = buildSnapshot(PROP, {
    auditType: AUDIT_TYPE.SPOT,
    scopeSections: ['room', 'bathroom', 'safety', 'reception', 'breakfast'],
    lockedAt: LOCKED_AT,
  });
  const row = snapshotToRow(spot);
  assert.deepEqual(row.scope_sections, ['room', 'bathroom', 'safety', 'reception', 'breakfast']);
  assert.deepEqual(snapshotFromRow({ ...row, tier: 'spot' }).scopeSections, row.scope_sections);
});

test('snapshotToRow refuses to write an unusable basis', () => {
  assert.equal(snapshotToRow(null), null);
  assert.equal(snapshotToRow({}), null);
  assert.equal(snapshotToRow({ propertyCategory: '5★' }), null);
});

// ── reading a row that never froze ──────────────────────────────────────────

test('a row with no lock date carries no basis, whatever else it holds', () => {
  // The lock date is the marker. A row with a category but no lock date never
  // froze, and must not be read as if it had.
  assert.equal(snapshotFromRow(null), null);
  assert.equal(snapshotFromRow({}), null);
  assert.equal(snapshotFromRow({ tier: 'full', property_category: '5★' }), null);
  assert.equal(snapshotFromRow({ ...asRow(frozen()), snapshot_locked_at: null }), null);
});

test('a partially written row reads as no basis rather than a partial one', () => {
  const half = { tier: 'full', snapshot_locked_at: LOCKED_AT, property_category: '5★', facility_profile: null };
  assert.equal(snapshotFromRow(half), null, 'no facility profile means nothing usable');
});

test('every one of the seven production audits reads as no basis', () => {
  // All seven carry null in all six columns. None may acquire one.
  const productionRow = {
    tier: 'full',
    property_category: null, facility_profile: null, scope_sections: null,
    framework_version: null, checklist_version: null, snapshot_locked_at: null,
  };
  assert.equal(snapshotFromRow(productionRow), null);
  assert.equal(classifyLoadedAudit(snapshotFromRow(productionRow), GRADES), SNAPSHOT_STATUS.LEGACY_UNFROZEN);
});

// ── resolution order: row, local, legacy, none ──────────────────────────────

test('the audit row outranks local storage', () => {
  const rowBasis = buildSnapshot({ ...PROP, category: '5★' }, FULL);
  const localBasis = buildSnapshot({ ...PROP, category: '4★' }, { ...FULL, lockedAt: '2026-01-01T00:00:00.000Z' });

  const picked = pickSnapshot(rowBasis, localBasis);
  assert.equal(picked.source, 'audit-row');
  assert.equal(picked.snapshot.propertyCategory, '5★', 'the row wins, not the cache');
  assert.equal(picked.snapshot.lockedAt, LOCKED_AT);
});

test('local storage is used only when the row has nothing', () => {
  const localBasis = frozen();
  const picked = pickSnapshot(null, localBasis);
  assert.equal(picked.source, 'local-cache');
  assert.deepEqual(picked.snapshot, localBasis);
});

test('neither source means no basis, and nothing is invented', () => {
  const picked = pickSnapshot(null, null);
  assert.equal(picked.source, 'none');
  assert.equal(picked.snapshot, null);
  assert.equal(classifyLoadedAudit(picked.snapshot, GRADES), SNAPSHOT_STATUS.LEGACY_UNFROZEN);
});

test('an unreadable local snapshot is kept, not discarded', () => {
  // Something was written down. It is reported as unusable rather than treated
  // as an audit that never had a basis.
  const broken = { propertyCategory: '5★' };
  const picked = pickSnapshot(null, broken);
  assert.equal(picked.source, 'local-cache');
  assert.deepEqual(picked.snapshot, broken);
  assert.equal(classifyLoadedAudit(picked.snapshot, GRADES), SNAPSHOT_STATUS.UNUSABLE);
});

test('a broken row falls through to a good local cache', () => {
  const localBasis = frozen();
  const picked = pickSnapshot({ property_category: '5★' }, localBasis);
  assert.equal(picked.source, 'local-cache');
  assert.deepEqual(picked.snapshot, localBasis);
});

// ── writing: once, and never over an existing basis ─────────────────────────

test('a basis is written only when the row does not already hold one', () => {
  assert.equal(shouldPersistSnapshot(frozen(), null), true, 'first lock writes');
  assert.equal(shouldPersistSnapshot(frozen(), frozen()), false, 'a second lock does not');
  assert.equal(shouldPersistSnapshot(null, null), false, 'nothing to write');
  assert.equal(shouldPersistSnapshot({}, null), false, 'an unusable basis is not written');
});

test('a stale client cannot overwrite a basis the row already holds', () => {
  const established = buildSnapshot({ ...PROP, category: '5★' }, FULL);
  const stale = buildSnapshot({ ...PROP, category: '4★' }, { ...FULL, lockedAt: '2026-12-01T00:00:00.000Z' });
  assert.equal(shouldPersistSnapshot(stale, established), false);
  // And the resolution order means the established one is what scores anyway.
  assert.equal(pickSnapshot(established, stale).snapshot.propertyCategory, '5★');
});

// ── decision 10: the legacy guard, explicitly ───────────────────────────────

test('10a. a graded audit with no basis stays legacy and creates nothing', () => {
  const row = { tier: 'full', property_category: null, facility_profile: null,
                scope_sections: null, framework_version: null, checklist_version: null,
                snapshot_locked_at: null };
  const picked = pickSnapshot(snapshotFromRow(row), null);
  const status = classifyLoadedAudit(picked.snapshot, GRADES);

  assert.equal(picked.snapshot, null, 'no snapshot is created');
  assert.equal(status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(canFreeze(status), false, 'and it can never freeze later');
  assert.equal(shouldPersistSnapshot(picked.snapshot, null), false, 'so nothing is ever written');
});

test('10b. a legacy audit receives none of today’s property as a historical basis', () => {
  const today = { ...PROP, category: 'Ultra', hasSpa: false, hasGym: true };
  const status = classifyLoadedAudit(null, GRADES);
  const basis = resolveScoringProfile(null, today, status);

  assert.equal(basis.frozen, false);
  assert.equal(basis.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(basis.lockedAt, null, 'no fabricated lock date');
  assert.equal(basis.frameworkVersion, null, 'no fabricated framework version');
  assert.equal(basis.checklistVersion, null);
  // It scores through the live property because there is nothing else, but it
  // records none of it as history.
  assert.equal(snapshotToRow(null), null, 'and nothing reaches the row');
});

test('10c. grading a legacy audit further still writes no basis', () => {
  let graded = { ...GRADES };
  const status = classifyLoadedAudit(null, graded);
  for (const id of ['RM-02', 'RM-03', 'BTH-01']) {
    graded = { ...graded, [id]: { day: { status: 'met' } } };
    assert.equal(canFreeze(status), false, `${id}: still refuses to freeze`);
    assert.equal(shouldPersistSnapshot(null, null), false, `${id}: still writes nothing`);
  }
});

test('10d. a new audit freezes at its first grade and persists', () => {
  const before = classifyLoadedAudit(null, {});
  assert.equal(before, SNAPSHOT_STATUS.NONE);
  assert.equal(canFreeze(before), true);

  const basis = frozen();
  assert.equal(shouldPersistSnapshot(basis, null), true);
  const row = snapshotToRow(basis);
  assert.ok(row.snapshot_locked_at, 'a real lock date is written');
  assert.equal(row.property_category, '5★');
});

test('10e. reload reads the persisted basis, and a later property change cannot move it', () => {
  const row = asRow(frozen());
  const reloaded = snapshotFromRow(row);

  // The property is rewritten after the lock.
  const today = { category: '4★', hasRestaurant: false, hasPool: false, hasSpa: false,
                  hasSauna: false, hasChangingRooms: false, hasMinibar: false,
                  hasLunchService: false, hasGym: false };
  const basis = resolveScoringProfile(reloaded, today, SNAPSHOT_STATUS.FROZEN);

  assert.equal(basis.frozen, true);
  assert.equal(basis.profile.category, '5★', 'the frozen category, not the live one');
  assert.equal(basis.profile.hasSpa, true);
  assert.equal(applicableItems(basis.profile).length, 130, 'the same 130 items as at lock');
});

// ── decision 11: the cross-device invariant ─────────────────────────────────

test('11. with a persisted basis and no local storage, the engine still resolves it', () => {
  // The foundation a future cross-device recovery flow would stand on. No UI is
  // involved: given only the audit row, the correct basis comes back.
  const row = asRow(frozen());

  const picked = pickSnapshot(snapshotFromRow(row), null);   // localStorage absent
  assert.equal(picked.source, 'audit-row');

  const status = classifyLoadedAudit(picked.snapshot, GRADES);
  assert.equal(status, SNAPSHOT_STATUS.FROZEN, 'frozen, not legacy');

  const basis = resolveScoringProfile(picked.snapshot, {}, status);
  assert.equal(basis.frozen, true);
  assert.equal(basis.lockedAt, LOCKED_AT);
  assert.equal(applicableItems(basis.profile).length, 130);
});

test('11b. without the row, the same audit is honestly legacy rather than wrong', () => {
  const picked = pickSnapshot(null, null);
  const status = classifyLoadedAudit(picked.snapshot, GRADES);
  assert.equal(status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(canFreeze(status), false);
});
