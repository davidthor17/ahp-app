// Phase 4B adversarial suite.
//
// Every scenario here reproduces an attack that succeeded against the previous
// framework. Each one must now fail. They are written as attacks rather than as
// unit tests so that a regression reads as "the exploit came back".

import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { applicableItems, catalogItems } from '../src/framework/catalog.js';
import {
  buildSnapshot,
  resolveScoringProfile,
  isUsableSnapshot,
  snapshotDrift,
  isFavourableChange,
  isFavourableScopeChange,
  FACILITY_FLAGS,
} from '../src/framework/snapshot.js';
import {
  itemChangeIsMaterial,
  severityChangeIsMaterial,
  trailEntry,
  TRAIL_ACTION,
} from '../src/framework/trail.js';
import {
  SEVERITY, AUDIT_TYPE, NA_REASON, STRUCTURAL_NA_CAP_PCT, WEIGHT_CLASSES, DIMENSIONS,
} from '../src/framework/weights.js';

const FULL_5 = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
const FULL = { auditType: AUDIT_TYPE.FULL };

const gradeAll = (profile, status, options) => {
  const g = {};
  for (const i of applicableItems(profile, options)) g[i.id] = { day: { status } };
  return g;
};
const run = (g, profile, ctx = FULL, options) => {
  const s = score(g, profile, options);
  return { s, c: certify(s, ctx) };
};

// Twenty four genuine, serious failures across the property.
const REAL_FAILURES = [
  'BTH-01', 'RM-02', 'RM-04', 'SAF-01', 'SAF-02', 'SAF-03', 'PL-03', 'PL-10',
  'BRK-01', 'RST-01', 'FBS-04', 'HK-03', 'DEP-01', 'ARR-08', 'SP-13', 'RST-12',
  'BRK-09', 'ARR-01', 'RM-01', 'FAC-01', 'FAC-02', 'FAC-03', 'LUN-02', 'SP-02',
];

// ── Attack 1: N/A erasure ──────────────────────────────────────────────────

test('24 failures recorded honestly cannot certify', () => {
  const g = gradeAll(FULL_5, 'met');
  REAL_FAILURES.forEach((id) => { if (g[id]) g[id] = { day: { status: 'missed' } }; });
  const { c } = run(g, FULL_5);
  assert.equal(c.level, 'none');
});

test('24 failures hidden as observational N/A cannot reach Elite', () => {
  const g = gradeAll(FULL_5, 'met');
  REAL_FAILURES.forEach((id) => {
    if (g[id]) g[id] = { day: { status: 'na', naReason: NA_REASON.NOT_OBSERVED } };
  });
  const { s, c } = run(g, FULL_5);
  assert.equal(s.overall, 100, 'what was assessed was met, so quality still reads 100');
  assert.ok(s.coverage < 90, `coverage ${s.coverage} must fall, an unobserved item is an unassessed item`);
  assert.notEqual(c.level, 'elite', 'the exploit reached Elite before Phase 4B');
  assert.equal(s.structuralNaShare, 0, 'observational N/A is not structural');
});

test('24 failures hidden as structural N/A blocks certification', () => {
  for (const reason of [NA_REASON.NOT_OFFERED, NA_REASON.NOT_PRESENT]) {
    const g = gradeAll(FULL_5, 'met');
    REAL_FAILURES.forEach((id) => { if (g[id]) g[id] = { day: { status: 'na', naReason: reason } }; });
    const { s, c } = run(g, FULL_5);
    assert.ok(s.structuralNaCapExceeded, `${reason} must breach the ${STRUCTURAL_NA_CAP_PCT}% cap`);
    assert.equal(c.level, 'none', `${reason} must not certify`);
    assert.ok(
      c.blockers.some((b) => /excluded as not applicable/.test(b)),
      c.blockers.join(' | '),
    );
  }
});

test('the structural cap is measured by weight, not by item count', () => {
  const items = applicableItems(FULL_5);
  const foundation = items.filter((i) => i.meta.weightClass === 'foundation').map((i) => i.id);
  const distinction = items.filter((i) => i.meta.weightClass === 'distinction').map((i) => i.id);

  const heavy = gradeAll(FULL_5, 'met');
  foundation.slice(0, 5).forEach((id) => { heavy[id] = { day: { status: 'na', naReason: NA_REASON.NOT_PRESENT } }; });
  const light = gradeAll(FULL_5, 'met');
  distinction.slice(0, 5).forEach((id) => { light[id] = { day: { status: 'na', naReason: NA_REASON.NOT_PRESENT } }; });

  const h = score(heavy, FULL_5);
  const l = score(light, FULL_5);
  assert.ok(h.structuralNaShare > l.structuralNaShare, 'erasing Foundation costs more than erasing Distinction');
  assert.equal(h.weights.structuralNa, 15, 'five Foundation items weigh 15');
  assert.equal(l.weights.structuralNa, 5, 'five Distinction items weigh 5');
});

test('a small, genuine structural exclusion stays valid', () => {
  const g = gradeAll(FULL_5, 'met');
  // PL-12 says "if applicable" in its own label. One item is exactly the case
  // the structural reason exists for.
  g['PL-12'] = { day: { status: 'na', naReason: NA_REASON.NOT_PRESENT } };
  const { s, c } = run(g, FULL_5);
  assert.ok(!s.structuralNaCapExceeded, `structural share ${s.structuralNaShare}% must stay under the cap`);
  assert.equal(c.level, 'elite', 'a property with no waterslide is not penalised');
  assert.equal(s.coverage, 100, 'a structurally absent item is not a coverage gap');
});

test('a genuinely absent facility needs no item-level N/A at all', () => {
  const noSpa = { ...FULL_5, hasSpa: false };
  const { s, c } = run(gradeAll(noSpa, 'met'), noSpa);
  assert.equal(s.structuralNaShare, 0, 'the facility profile removed the section, not N/A');
  assert.equal(s.coverage, 100);
  assert.equal(c.level, 'elite');
});

test('an N/A with no reason is read as observational, never as an eraser', () => {
  const g = gradeAll(FULL_5, 'met');
  REAL_FAILURES.forEach((id) => { if (g[id]) g[id] = { day: { status: 'na' } }; });
  const s = score(g, FULL_5);
  assert.equal(s.structuralNaShare, 0, 'a legacy row can never improve a historical score');
  assert.ok(s.coverage < 90);
});

// ── Attack 2: Partial on a Critical item ───────────────────────────────────

test('Critical items recorded Partial keep blocking, at every count', () => {
  const crits = applicableItems(FULL_5)
    .filter((i) => i.meta.defaultSeverity === SEVERITY.CRITICAL).map((i) => i.id);
  for (const n of [1, 3, 6]) {
    const g = gradeAll(FULL_5, 'met');
    crits.slice(0, n).forEach((id) => { g[id] = { day: { status: 'partial' } }; });
    const { s, c } = run(g, FULL_5);
    assert.equal(s.findingCounts.critical, n, `${n} Partial Critical items raise ${n} Critical findings`);
    assert.equal(c.level, 'none', `${n} Partial Critical items reached Elite or Certified before Phase 4B`);
  }
});

test('Major and Minor items still step down on Partial', () => {
  const items = applicableItems(FULL_5);
  const major = items.find((i) => i.meta.defaultSeverity === SEVERITY.MAJOR);
  const g = gradeAll(FULL_5, 'met');
  g[major.id] = { day: { status: 'partial' } };
  const s = score(g, FULL_5);
  assert.equal(s.findingCounts.major, 0);
  assert.equal(s.findingCounts.minor, 1, 'only the Critical case changed');
});

test('there is no path to lower a finding', () => {
  const g = gradeAll(FULL_5, 'met');
  g['BTH-01'] = { day: { status: 'missed', escalation: { severity: SEVERITY.MAJOR } } };
  const { s, c } = run(g, FULL_5);
  assert.equal(s.escalationErrors.length, 1, 'the attempt is reported');
  assert.match(s.escalationErrors[0].message, /never lowered/);
  assert.equal(s.findingCounts.critical, 1, 'the derived Critical stands');
  assert.equal(c.level, 'none');
});

// ── Attacks 3 and 4: snapshot ──────────────────────────────────────────────

test('a snapshot freezes the scoring basis', () => {
  const prop = { ...FULL_5 };
  const snap = buildSnapshot(prop, { auditType: AUDIT_TYPE.FULL, lockedAt: '2026-08-28T10:00:00Z' });
  assert.ok(isUsableSnapshot(snap));
  assert.equal(snap.propertyCategory, '5★');
  assert.deepEqual(Object.keys(snap.facilityProfile).sort(), FACILITY_FLAGS.slice().sort());
  assert.ok(snap.frameworkVersion, 'the framework version is recorded');
  assert.ok(snap.checklistVersion, 'the checklist version is recorded');
});

test('changing the live property does not move a snapshotted audit', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });
  const graded = gradeAll(FULL_5, 'met');

  const before = resolveScoringProfile(snap, FULL_5);
  const beforeScore = score(graded, before.profile);

  // The hotel closes its spa, its pool and its restaurant, and is recategorised.
  const laterProp = { category: '4★', hasRestaurant: false, hasPool: false, hasSpa: false };
  const after = resolveScoringProfile(snap, laterProp);
  const afterScore = score(graded, after.profile);

  assert.equal(after.source, 'snapshot');
  assert.equal(afterScore.weights.applicable, beforeScore.weights.applicable, 'the applicable pool is unchanged');
  assert.equal(afterScore.overall, beforeScore.overall);
  assert.equal(afterScore.coverage, beforeScore.coverage);
  assert.equal(afterScore.profile.category, '5★', 'scored against the snapshot, not the live row');
});

test('the rooms-only exploit cannot be applied after the fact', () => {
  const g = gradeAll(FULL_5, 'met');
  ['SP-02', 'SP-03', 'PL-03', 'PL-10', 'BRK-01', 'RST-01'].forEach((id) => {
    if (g[id]) g[id] = { day: { status: 'missed' } };
  });
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });

  const honest = certify(score(g, resolveScoringProfile(snap, FULL_5).profile), FULL);
  const roomsOnly = { category: '5★', hasRestaurant: false, hasPool: false, hasSpa: false };
  const dodged = certify(score(g, resolveScoringProfile(snap, roomsOnly).profile), FULL);

  assert.equal(honest.level, 'none');
  assert.equal(dodged.level, 'none', 'redeclaring the property cannot rescue the audit');
});

test('a missing snapshot falls back to the live property and says so', () => {
  const r = resolveScoringProfile(null, FULL_5);
  assert.equal(r.source, 'live-property-fallback');
  assert.equal(r.profile.category, '5★');
  assert.equal(r.frameworkVersion, null, 'a reconstructed basis records no version');
});

test('drift between the snapshot and the property is reported, not hidden', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });
  assert.equal(snapshotDrift(snap, FULL_5), null, 'no drift when nothing moved');
  const drift = snapshotDrift(snap, { category: '4★', hasRestaurant: true, hasPool: true, hasSpa: false });
  assert.equal(drift.length, 2);
  assert.ok(drift.some((d) => d.field === 'category' && d.was === '5★' && d.now === '4★'));
  assert.ok(drift.some((d) => d.field === 'hasSpa' && d.was === true && d.now === false));
});

test('favourable changes are the ones that need a reason', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });
  assert.equal(isFavourableChange(snap, { ...FULL_5, hasSpa: false }), true, 'removing a facility helps the property');
  assert.equal(isFavourableChange(snap, { ...FULL_5, category: '4★' }), true, 'lowering the category helps');
  assert.equal(isFavourableChange(snap, { ...FULL_5, category: 'Ultra' }), false, 'raising the category does not');
  const noSpaSnap = buildSnapshot({ ...FULL_5, hasSpa: false }, { auditType: AUDIT_TYPE.FULL });
  assert.equal(isFavourableChange(noSpaSnap, FULL_5), false, 'adding a facility can only add items');
});

// ── Attack 5: Spot scope ───────────────────────────────────────────────────

test('Spot coverage is measured against the declared scope', () => {
  const scope = ['arrival', 'room', 'breakfast', 'restaurant'];
  const g = gradeAll(FULL_5, 'met', { scopeSections: scope });

  const unscoped = run(g, FULL_5, { auditType: AUDIT_TYPE.SPOT });
  const scoped = run(g, FULL_5, { auditType: AUDIT_TYPE.SPOT }, { scopeSections: scope });

  assert.ok(unscoped.s.coverage < 40, `against the whole property coverage is ${unscoped.s.coverage}`);
  assert.equal(unscoped.c.level, 'none', 'which is why a Spot Audit could never certify');
  assert.equal(scoped.s.coverage, 100, 'against its declared scope it is complete');
  assert.equal(scoped.c.level, 'certified', 'and Certified becomes reachable');
});

test('a Spot Audit still cannot exceed Certified', () => {
  const scope = ['arrival', 'room', 'breakfast', 'restaurant'];
  const g = gradeAll(FULL_5, 'met', { scopeSections: scope });
  const { c } = run(g, FULL_5, { auditType: AUDIT_TYPE.SPOT }, { scopeSections: scope });
  assert.equal(c.level, 'certified');
  assert.equal(c.ceiling, 'certified');
});

test('an undeclared scope fails safe, scoring the whole property', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.SPOT, scopeSections: null });
  assert.equal(snap.scopeSections, null);
  const resolved = resolveScoringProfile(snap, FULL_5);
  assert.equal(resolved.scopeSections, null, 'no scope means the full catalogue, never an empty one');
});

test('a scope is only recorded for a Spot Audit', () => {
  const asFull = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL, scopeSections: ['room'] });
  assert.equal(asFull.scopeSections, null, 'a Full Audit cannot narrow itself');
  const asSpot = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.SPOT, scopeSections: ['room', 'room'] });
  assert.deepEqual(asSpot.scopeSections, ['room'], 'and duplicates are collapsed');
});

test('narrowing a declared scope is a favourable change', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.SPOT, scopeSections: ['arrival', 'room', 'breakfast'] });
  assert.equal(isFavourableScopeChange(snap, ['arrival', 'room']), true);
  assert.equal(isFavourableScopeChange(snap, ['arrival', 'room', 'breakfast', 'spa']), false);
});

// ── Attack 6: assessment states ────────────────────────────────────────────

test('every empty state names itself', () => {
  const items = applicableItems(FULL_5);

  const nothing = certify(score({}, FULL_5), FULL);
  assert.equal(nothing.outcome, 'NO_ITEMS_GRADED');
  assert.match(nothing.reasons[0], /No items have been assessed yet/);

  const noFoundation = {};
  items.filter((i) => i.meta.weightClass !== 'foundation')
    .forEach((i) => { noFoundation[i.id] = { day: { status: 'met' } }; });
  const nf = score(noFoundation, FULL_5);
  const nfc = certify(nf, FULL);
  assert.equal(nf.counts.graded, 99, 'ninety nine items really were graded');
  assert.equal(nf.assessmentByClass.foundation.state, 'none_graded');
  assert.equal(nfc.outcome, 'FOUNDATION_NOT_GRADED', 'not the old "No graded items"');
  assert.match(nfc.reasons[0], /none of the \d+ fundamentals were/);
  assert.equal(nfc.level, 'none');

  const partial = score({ 'RM-01': { day: { status: 'met' } } }, FULL_5);
  assert.equal(partial.assessment.state, 'partial');
  assert.equal(partial.assessmentByClass.foundation.state, 'partial');

  const complete = score(gradeAll(FULL_5, 'met'), FULL_5);
  assert.equal(complete.assessment.state, 'complete');
  assert.equal(complete.assessmentByClass.foundation.state, 'complete');
});

test('Foundation below its floor is a different outcome from Foundation unassessed', () => {
  const g = gradeAll(FULL_5, 'met');
  applicableItems(FULL_5)
    .filter((i) => i.meta.weightClass === 'foundation' && i.meta.defaultSeverity === SEVERITY.MAJOR)
    .slice(0, 4)
    .forEach((i) => { g[i.id] = { day: { status: 'missed' } }; });
  const c = certify(score(g, FULL_5), FULL);
  assert.equal(c.outcome, 'BELOW_REQUIREMENT', 'assessed, but not good enough');
  assert.ok(c.reasons.some((r) => /Foundation score/.test(r)));
});

// ── Attack 7: audit trail ──────────────────────────────────────────────────

test('only changes that could help the property are recorded', () => {
  // Improving grades.
  assert.equal(itemChangeIsMaterial({ status: 'missed' }, { status: 'met' }).action, TRAIL_ACTION.STATUS_IMPROVED);
  assert.equal(itemChangeIsMaterial({ status: 'missed' }, { status: 'partial' }).action, TRAIL_ACTION.STATUS_IMPROVED);
  assert.equal(itemChangeIsMaterial({ status: 'partial' }, { status: 'met' }).action, TRAIL_ACTION.STATUS_IMPROVED);
  // Failing grade hidden behind N/A.
  const toNa = itemChangeIsMaterial({ status: 'missed' }, { status: 'na', naReason: NA_REASON.NOT_PRESENT });
  assert.equal(toNa.action, TRAIL_ACTION.STATUS_TO_NA);
  assert.equal(toNa.requiresReason, true);
  assert.equal(toNa.requiresRelease, true, 'structural N/A needs a reviewer');
  const toObserved = itemChangeIsMaterial({ status: 'partial' }, { status: 'na', naReason: NA_REASON.NOT_OBSERVED });
  assert.equal(toObserved.requiresRelease, false);
  // Observational N/A quietly becoming structural.
  const escalatedNa = itemChangeIsMaterial(
    { status: 'na', naReason: NA_REASON.NOT_OBSERVED },
    { status: 'na', naReason: NA_REASON.NOT_OFFERED },
  );
  assert.equal(escalatedNa.action, TRAIL_ACTION.NA_REASON_CHANGED);

  // Nothing that lowers the score is logged.
  assert.equal(itemChangeIsMaterial({ status: 'met' }, { status: 'missed' }), null);
  assert.equal(itemChangeIsMaterial({ status: 'met' }, { status: 'partial' }), null);
  assert.equal(itemChangeIsMaterial({ status: 'na', naReason: NA_REASON.NOT_OFFERED }, { status: 'missed' }), null);
  // A first assessment is an observation, not a change.
  assert.equal(itemChangeIsMaterial({}, { status: 'met' }), null);
  assert.equal(itemChangeIsMaterial({ status: 'met' }, { status: 'met' }), null);
});

test('lowering a severity is recorded, raising one is not', () => {
  const lowered = severityChangeIsMaterial(SEVERITY.CRITICAL, SEVERITY.MAJOR);
  assert.equal(lowered.action, TRAIL_ACTION.SEVERITY_LOWERED);
  assert.equal(lowered.requiresReason, true);
  assert.equal(lowered.requiresRelease, true);
  assert.equal(severityChangeIsMaterial(SEVERITY.ZERO_TOLERANCE, SEVERITY.CRITICAL).requiresRelease, true);
  assert.equal(severityChangeIsMaterial(SEVERITY.MAJOR, SEVERITY.CRITICAL), null, 'raising needs no trail');
  assert.equal(severityChangeIsMaterial(SEVERITY.MAJOR, SEVERITY.MAJOR), null);
});

test('a trail entry can reconstruct what happened', () => {
  const e = trailEntry({
    auditId: 'a-1', actorId: 'u-1', action: TRAIL_ACTION.STATUS_TO_NA,
    itemId: 'BTH-01', field: 'status', from: 'missed', to: 'na',
    reason: 'Bathroom was out of service', at: '2026-08-28T12:00:00Z',
  });
  assert.equal(e.entity_type, 'audit');
  assert.equal(e.entity_id, 'a-1');
  assert.equal(e.actor_id, 'u-1');
  assert.equal(e.action, TRAIL_ACTION.STATUS_TO_NA);
  assert.deepEqual(e.diff, {
    itemId: 'BTH-01', field: 'status', from: 'missed', to: 'na',
    reason: 'Bathroom was out of service', observedAt: '2026-08-28T12:00:00Z',
  });
  // Shaped for public.activity_log exactly, no extra keys.
  assert.deepEqual(Object.keys(e).sort(), ['action', 'actor_id', 'diff', 'entity_id', 'entity_type']);
});

// ── Reproducibility and full catalogue ─────────────────────────────────────

test('the same snapshot and the same responses give the same result, always', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });
  const g = gradeAll(FULL_5, 'met');
  g['BTH-01'] = { day: { status: 'partial' } };
  g['PL-12'] = { day: { status: 'na', naReason: NA_REASON.NOT_PRESENT } };

  const once = certify(score(g, resolveScoringProfile(snap, FULL_5).profile), FULL);
  const twice = certify(score(g, resolveScoringProfile(snap, { category: 'Ultra', hasSpa: false }).profile), FULL);
  assert.deepEqual(twice.measured, once.measured);
  assert.equal(twice.level, once.level);
  assert.deepEqual(twice.blockers, once.blockers);
});

test('all 147 items across every facility combination behave in class', () => {
  const combos = [];
  for (const hasRestaurant of [true, false]) {
    for (const hasPool of [true, false]) {
      for (const hasSpa of [true, false]) {
        for (const category of ['4★', '5★', 'Ultra']) combos.push({ category, hasRestaurant, hasPool, hasSpa });
      }
    }
  }
  assert.equal(combos.length, 24);

  const seen = { severity: new Set(), dimension: new Set(), weightClass: new Set() };
  for (const profile of combos) {
    const items = applicableItems(profile);
    const g = gradeAll(profile, 'met');
    const base = certify(score(g, profile), FULL);
    assert.ok(['certified', 'exceptional', 'elite'].includes(base.level), `${JSON.stringify(profile)} flawless should certify`);

    for (const item of items) {
      seen.severity.add(item.meta.defaultSeverity);
      seen.dimension.add(item.meta.dimension);
      seen.weightClass.add(item.meta.weightClass);
    }
  }
  assert.deepEqual([...seen.severity].sort(), ['critical', 'major', 'minor']);
  assert.deepEqual([...seen.dimension].sort(), DIMENSIONS.slice().sort());
  assert.deepEqual([...seen.weightClass].sort(), WEIGHT_CLASSES.slice().sort());
  assert.equal(catalogItems().length, 147);
});

test('every Critical item blocks from Missed and from Partial alike', () => {
  const crits = applicableItems(FULL_5).filter((i) => i.meta.defaultSeverity === SEVERITY.CRITICAL);
  assert.equal(crits.length, 18, 'every Critical item applies to a 5★ with every facility');
  for (const item of crits) {
    for (const status of ['missed', 'partial']) {
      const g = gradeAll(FULL_5, 'met');
      g[item.id] = { day: { status } };
      const { s, c } = run(g, FULL_5);
      assert.equal(s.findingCounts.critical, 1, `${item.id} ${status}`);
      assert.equal(c.level, 'none', `${item.id} ${status} must block`);
    }
  }
});
