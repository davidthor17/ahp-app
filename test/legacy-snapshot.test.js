// Phase 5.3 — legacy audits must never acquire a historical basis.
//
// A missing snapshot used to mean two things at once: an audit that had not
// started, and an audit carried out before snapshots existed. The first-grade
// lock could not tell them apart, so opening a legacy audit minted a snapshot
// from today's property, stamped it with today's date and the current
// framework version, and presented that reconstruction as a record.
//
// SNAPSHOT_STATUS separates the two. These tests model the console's lifecycle
// — adopt an audit, then offer it grades — and assert that only an audit which
// has recorded nothing yet is ever allowed to freeze.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSnapshot, resolveScoringProfile, classifyLoadedAudit, canFreeze,
  hasAnyGrade, isUnfrozenStatus, snapshotStatusOf, SNAPSHOT_STATUS,
} from '../src/framework/snapshot.js';
import { FRAMEWORK_VERSION, CHECKLIST_VERSION } from '../src/framework/version.js';
import { score } from '../src/framework/scoring.js';
import { AUDIT_TYPE } from '../src/framework/weights.js';

const PROP = {
  name: 'Hotel Borealis', category: '5★',
  hasRestaurant: true, hasPool: true, hasSpa: true,
  hasSauna: true, hasChangingRooms: true, hasMinibar: true, hasLunchService: true, hasGym: true,
};

// The property as it stands today, long after the legacy audit was carried out.
const PROP_TODAY = {
  name: 'Hotel Borealis', category: '4★',
  hasRestaurant: false, hasPool: false, hasSpa: false,
  hasSauna: false, hasChangingRooms: false, hasMinibar: false, hasLunchService: false, hasGym: false,
};

const GRADES = { 'RM-01': { day: { status: 'met' } }, 'PL-01': { day: { status: 'missed' } } };

/**
 * The console's snapshot lifecycle, with the same rules App.jsx applies.
 *
 * adopt() is every path that loads an audit from somewhere else: local
 * storage, the items table, a reviewer opening one. grade() is the auditor
 * recording something now. The distinction between them is the whole point —
 * it is the only thing that separates a new audit from a legacy one.
 */
function auditSession(prop) {
  let snapshot = null;
  let status = SNAPSHOT_STATUS.NONE;
  let graded = {};

  const api = {
    adopt(nextGraded, nextSnapshot = null) {
      status = classifyLoadedAudit(nextSnapshot, nextGraded);
      snapshot = nextSnapshot || null;
      graded = { ...(nextGraded || {}) };
      return api;
    },
    grade(itemId, itemStatus = 'met') {
      graded = { ...graded, [itemId]: { day: { status: itemStatus } } };
      // The lock effect, exactly as App.jsx guards it.
      if (!snapshot && canFreeze(status) && hasAnyGrade(graded) && prop.name) {
        status = SNAPSHOT_STATUS.FROZEN;
        snapshot = buildSnapshot(prop, {
          auditType: AUDIT_TYPE.FULL, lockedAt: new Date().toISOString(),
        });
      }
      return api;
    },
    /** Everything that survives a reload, and nothing that does not. */
    reload() {
      const stored = JSON.parse(JSON.stringify({ snapshot, audit: graded }));
      return auditSession(prop).adopt(stored.audit, stored.snapshot);
    },
    get snapshot() { return snapshot; },
    get status() { return status; },
    get graded() { return graded; },
    basis(liveProp = prop) { return resolveScoringProfile(snapshot, liveProp, status); },
  };
  return api;
}

// ── A. fresh audit before its first grade ──────────────────────────────────

test('A. a fresh audit has no snapshot and no legacy label', () => {
  const s = auditSession(PROP);
  assert.equal(s.snapshot, null);
  assert.equal(s.status, SNAPSHOT_STATUS.NONE);
  assert.equal(canFreeze(s.status), true, 'and is still allowed to freeze');
  assert.equal(s.basis().source, 'live-property-fallback', 'setup stays editable');
  assert.equal(s.basis().frozen, false);
});

// ── B. fresh audit at its first grade ──────────────────────────────────────

test('B. the first grade on a fresh audit freezes a basis', () => {
  const s = auditSession(PROP).grade('RM-01');
  assert.equal(s.status, SNAPSHOT_STATUS.FROZEN);
  assert.ok(s.snapshot, 'a snapshot exists');
  assert.equal(s.snapshot.propertyCategory, '5★');
  assert.equal(s.snapshot.frameworkVersion, FRAMEWORK_VERSION, 'stamped honestly, at the time');
  assert.equal(s.snapshot.checklistVersion, CHECKLIST_VERSION);
  assert.ok(s.snapshot.lockedAt, 'with a real lock date');
  assert.equal(s.basis().frozen, true);
  assert.equal(s.basis().source, 'snapshot');
});

// ── C. an audit that already has a basis ───────────────────────────────────

test('C. an existing snapshot is never replaced or altered', () => {
  const s = auditSession(PROP).grade('RM-01');
  const frozen = JSON.parse(JSON.stringify(s.snapshot));
  s.grade('RM-02').grade('RM-03', 'missed');
  assert.deepEqual(s.snapshot, frozen, 'further grading does not touch the basis');
  assert.equal(s.status, SNAPSHOT_STATUS.FROZEN);
});

// ── D. the defect: legacy audit, grades, no basis ──────────────────────────

test('D. a legacy audit does not mint a snapshot when it is loaded', () => {
  const s = auditSession(PROP_TODAY).adopt(GRADES, null);
  assert.equal(s.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(s.snapshot, null, 'nothing was fabricated');
  assert.equal(canFreeze(s.status), false, 'and it can never freeze later');
});

test('D. a legacy audit invents no date and no version', () => {
  const basis = auditSession(PROP_TODAY).adopt(GRADES, null).basis();
  assert.equal(basis.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(basis.frozen, false);
  assert.equal(basis.lockedAt, null, 'no fabricated lock date');
  assert.equal(basis.frameworkVersion, null, 'no fabricated framework version');
  assert.equal(basis.checklistVersion, null, 'no fabricated checklist version');
  assert.equal(basis.source, 'live-property-fallback');
});

test('D. grading a legacy audit further still does not freeze it', () => {
  // The chosen rule: once legacy, always legacy. Anything frozen today would
  // be today's property wearing a historical timestamp.
  const s = auditSession(PROP_TODAY).adopt(GRADES, null);
  s.grade('RM-02').grade('RM-03', 'partial');
  assert.equal(s.snapshot, null);
  assert.equal(s.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
});

// ── E. legacy audit whose property has since changed ───────────────────────

test('E. changing the property while a legacy audit is open mints nothing', () => {
  const s = auditSession(PROP_TODAY).adopt(GRADES, null);
  const before = s.basis(PROP);
  const after = s.basis(PROP_TODAY);
  assert.equal(s.snapshot, null, 'still no snapshot');
  assert.equal(s.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  // The fallback follows the live property, which is the honest thing an
  // unfrozen audit can do — and exactly why it is labelled unfrozen.
  assert.equal(before.profile.category, '5★');
  assert.equal(after.profile.category, '4★');
  assert.equal(before.frozen, false);
  assert.equal(after.frozen, false);
});

// ── F. a published legacy audit opened by a reviewer ───────────────────────

test('F. opening a published legacy audit does not mint a snapshot', () => {
  const s = auditSession(PROP_TODAY).adopt(GRADES, null);
  assert.equal(s.snapshot, null);
  assert.equal(s.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
});

test('F. one audit’s basis never follows the reviewer into the next', () => {
  // openAuditForReview adopts with an explicit null. Before Phase 5.3 it left
  // the previous audit's snapshot in state, and a legacy audit opened after a
  // frozen one was scored against the frozen one's category and facilities.
  const reviewer = auditSession(PROP);
  reviewer.adopt({ 'RM-01': { day: { status: 'met' } } }, buildSnapshot(PROP, {
    auditType: AUDIT_TYPE.FULL, lockedAt: '2026-07-01T09:00:00Z',
  }));
  assert.equal(reviewer.status, SNAPSHOT_STATUS.FROZEN);

  reviewer.adopt(GRADES, null);
  assert.equal(reviewer.snapshot, null, 'the previous basis did not come along');
  assert.equal(reviewer.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(reviewer.basis().profile.category, '5★', 'it reads the live property, not the old snapshot');
});

test('F. closing a reviewed audit clears the basis with it', () => {
  const reviewer = auditSession(PROP).adopt(GRADES, buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL }));
  assert.equal(reviewer.status, SNAPSHOT_STATUS.FROZEN);
  reviewer.adopt({}, null); // closeReviewAudit
  assert.equal(reviewer.snapshot, null);
  assert.equal(reviewer.status, SNAPSHOT_STATUS.NONE, 'an empty audit is not legacy, it is nothing');
});

// ── G. a legacy audit still scores ─────────────────────────────────────────

test('G. a legacy audit scores through the fallback and is marked unfrozen', () => {
  const s = auditSession(PROP_TODAY).adopt(GRADES, null);
  const basis = s.basis(PROP_TODAY);
  const result = score(s.graded, basis.profile, { scopeSections: basis.scopeSections });

  assert.ok(result.counts.applicable > 0, 'it still produces a score');
  assert.equal(result.counts.graded, 1, 'PL-01 is out of scope at this property, RM-01 is not');
  assert.equal(isUnfrozenStatus(basis.status), true, 'and never claims to be a record');
  assert.equal(basis.frozen, false);
});

test('G. usability is preserved: a legacy audit is not blocked or emptied', () => {
  const s = auditSession(PROP_TODAY).adopt(GRADES, null);
  s.grade('RM-04', 'partial');
  assert.equal(Object.keys(s.graded).length, 3, 'it can still be worked on');
  assert.equal(s.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
});

// ── H. the status survives a reload ────────────────────────────────────────

test('H. legacy survives a reload without quietly becoming frozen', () => {
  let s = auditSession(PROP_TODAY).adopt(GRADES, null);
  for (let i = 0; i < 3; i++) {
    s = s.reload();
    assert.equal(s.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN, `still legacy after reload ${i + 1}`);
    assert.equal(s.snapshot, null, `still no snapshot after reload ${i + 1}`);
  }
});

test('H. a frozen audit survives a reload unchanged', () => {
  const s = auditSession(PROP).grade('RM-01');
  const frozen = JSON.parse(JSON.stringify(s.snapshot));
  const reloaded = s.reload().reload();
  assert.equal(reloaded.status, SNAPSHOT_STATUS.FROZEN);
  assert.deepEqual(reloaded.snapshot, frozen, 'byte for byte');
});

test('H. a fresh audit that reloads before its first grade is not legacy', () => {
  const s = auditSession(PROP).reload();
  assert.equal(s.status, SNAPSHOT_STATUS.NONE);
  s.grade('RM-01');
  assert.equal(s.status, SNAPSHOT_STATUS.FROZEN, 'it can still freeze normally');
});

// ── I. a malformed snapshot ────────────────────────────────────────────────

const MALFORMED = [
  ['empty object', {}],
  ['no facility profile', { propertyCategory: '5★' }],
  ['no category', { facilityProfile: { hasRestaurant: true, hasPool: true, hasSpa: true } }],
  ['non-boolean section flag', { propertyCategory: '5★', facilityProfile: { hasRestaurant: 'yes', hasPool: true, hasSpa: true } }],
  ['facility profile is a string', { propertyCategory: '5★', facilityProfile: 'gone' }],
];

test('I. a malformed snapshot is reported unusable, never overwritten', () => {
  for (const [label, broken] of MALFORMED) {
    const s = auditSession(PROP_TODAY).adopt(GRADES, broken);
    assert.equal(s.status, SNAPSHOT_STATUS.UNUSABLE, `${label}: recognised as unusable`);
    assert.deepEqual(s.snapshot, broken, `${label}: kept exactly as found`);

    s.grade('RM-02');
    assert.deepEqual(s.snapshot, broken, `${label}: grading does not repair or replace it`);
    assert.equal(s.status, SNAPSHOT_STATUS.UNUSABLE, `${label}: and does not relabel it`);

    const basis = s.basis(PROP_TODAY);
    assert.equal(basis.frozen, false, `${label}: it is not treated as a record`);
    assert.equal(basis.lockedAt, null, `${label}: no date is borrowed from it`);
    assert.equal(basis.frameworkVersion, null, `${label}: no version is borrowed from it`);
    assert.equal(basis.source, 'live-property-fallback', `${label}: scored against the live property`);
  }
});

test('I. unusable is distinct from legacy: something was written down', () => {
  // The difference matters. Legacy means no basis was ever recorded and none
  // can be. Unusable means one was recorded and cannot be read, which is a
  // data problem somebody may still be able to recover from a backup.
  const legacy = auditSession(PROP_TODAY).adopt(GRADES, null);
  const broken = auditSession(PROP_TODAY).adopt(GRADES, { propertyCategory: '5★' });
  assert.notEqual(legacy.status, broken.status);
  assert.equal(isUnfrozenStatus(legacy.status), true);
  assert.equal(isUnfrozenStatus(broken.status), true, 'neither is scored as a record');
});

// ── The helpers themselves ─────────────────────────────────────────────────

test('hasAnyGrade counts any recorded status, N/A included', () => {
  assert.equal(hasAnyGrade({}), false);
  assert.equal(hasAnyGrade({ 'RM-01': {} }), false);
  assert.equal(hasAnyGrade({ 'RM-01': { day: {} } }), false);
  assert.equal(hasAnyGrade({ 'RM-01': { day: { note: 'looked at it' } } }), false, 'a note alone is not a grade');
  assert.equal(hasAnyGrade({ 'RM-01': { day: { status: 'na' } } }), true, 'N/A starts an audit');
  assert.equal(hasAnyGrade({ 'RM-01': { day: { status: 'met' } } }), true);
  assert.equal(hasAnyGrade(null), false);
  assert.equal(hasAnyGrade(undefined), false);
});

test('snapshotStatusOf cannot see legacy, and does not guess at it', () => {
  assert.equal(snapshotStatusOf(null), SNAPSHOT_STATUS.NONE);
  assert.equal(snapshotStatusOf(undefined), SNAPSHOT_STATUS.NONE);
  assert.equal(snapshotStatusOf({}), SNAPSHOT_STATUS.UNUSABLE);
  assert.equal(snapshotStatusOf(buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL })), SNAPSHOT_STATUS.FROZEN);
});

test('classifyLoadedAudit is the only place legacy is decided', () => {
  assert.equal(classifyLoadedAudit(null, {}), SNAPSHOT_STATUS.NONE);
  assert.equal(classifyLoadedAudit(null, GRADES), SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(classifyLoadedAudit({}, GRADES), SNAPSHOT_STATUS.UNUSABLE);
  const good = buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL });
  assert.equal(classifyLoadedAudit(good, GRADES), SNAPSHOT_STATUS.FROZEN);
  assert.equal(classifyLoadedAudit(good, {}), SNAPSHOT_STATUS.FROZEN);
});

test('canFreeze admits exactly one status', () => {
  assert.equal(canFreeze(SNAPSHOT_STATUS.NONE), true);
  for (const s of [SNAPSHOT_STATUS.FROZEN, SNAPSHOT_STATUS.LEGACY_UNFROZEN, SNAPSHOT_STATUS.UNUSABLE]) {
    assert.equal(canFreeze(s), false, `${s} must never freeze`);
  }
});

test('a resolved basis always states which of the two it is', () => {
  const frozen = resolveScoringProfile(buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL }), PROP, SNAPSHOT_STATUS.FROZEN);
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.status, SNAPSHOT_STATUS.FROZEN);

  // A caller claiming FROZEN with nothing readable to freeze against is
  // corrected rather than believed.
  const lying = resolveScoringProfile({ propertyCategory: '5★' }, PROP, SNAPSHOT_STATUS.FROZEN);
  assert.equal(lying.frozen, false);
  assert.equal(lying.status, SNAPSHOT_STATUS.UNUSABLE);

  // Called without a status, as older code does, it still never claims frozen.
  const legacy = resolveScoringProfile(null, PROP);
  assert.equal(legacy.frozen, false);
  assert.equal(legacy.status, SNAPSHOT_STATUS.NONE);
});
