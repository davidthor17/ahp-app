// Phase 4C: dependency gating, Foundation assessment completeness and the
// Spot Audit certification core.
//
// Lettered tests map to the approved attack list. Each one either reproduces an
// exploit that must now fail, or an honest property that must not.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { score } from '../src/framework/scoring.js';
import { certify, spotScopeEligibility } from '../src/framework/certification.js';
import { applicableItems, catalogItems } from '../src/framework/catalog.js';
import {
  buildSnapshot, resolveScoringProfile, withDependencyDefaults,
  DEPENDENCY_FLAGS, SECTION_FACILITY_FLAGS,
} from '../src/framework/snapshot.js';
import { FRAMEWORK, FRAMEWORK_VERSION, CHECKLIST_VERSION } from '../src/framework/version.js';
import {
  AUDIT_TYPE, NA_REASON, FOUNDATION_ALLOWANCE, SPOT_CORE_SECTIONS, SPOT_MIN_ADDITIONAL_SECTIONS,
} from '../src/framework/weights.js';

// A full-service property. Every dependency flag present unless stated.
const FULL_5 = {
  category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true,
  hasSauna: true, hasChangingRooms: true, hasMinibar: true, hasLunchService: true, hasGym: true,
};
const FULL = { auditType: AUDIT_TYPE.FULL };

const gradeAll = (profile, status = 'met', options) => {
  const g = {};
  for (const i of applicableItems(profile, options)) g[i.id] = { day: { status } };
  return g;
};
const run = (g, profile, ctx = FULL, options) => {
  const s = score(g, profile, options);
  return { s, c: certify(s, { ...ctx, ...(options || {}) }) };
};
const foundationIds = (profile) =>
  applicableItems(profile).filter((i) => i.meta.weightClass === 'foundation').map((i) => i.id);

// ── The gate map, asserted against the catalogue itself ────────────────────

test('exactly the approved items carry a dependency gate', () => {
  const gated = catalogItems().filter((i) => i.requires);
  assert.deepEqual(
    gated.map((i) => [i.id, i.requires]).sort(),
    [
      ['FAC-04', 'hasGym'], ['FAC-05', 'hasGym'], ['FAC-06', 'hasGym'],
      ['LUN-02', 'hasLunchService'], ['RM-10', 'hasMinibar'],
      ['SP-02', 'hasChangingRooms'], ['SP-03', 'hasChangingRooms'], ['SP-04', 'hasSauna'],
    ].sort(),
  );
  // Five of the eight are Foundation, which is why they mattered.
  assert.equal(gated.filter((i) => i.meta.weightClass === 'foundation').length, 5);
});

test('PL-03 no longer names chlorine specifically, and is otherwise untouched', () => {
  const pl03 = catalogItems().find((i) => i.id === 'PL-03');
  assert.match(pl03.label, /^Sanitiser levels/);
  assert.doesNotMatch(pl03.label, /[Cc]hlorine/);
  assert.equal(pl03.meta.weightClass, 'foundation');
  assert.equal(pl03.meta.defaultSeverity, 'critical');
  assert.equal(pl03.meta.zeroToleranceEligible, true);
  assert.equal(pl03.minStars, 4);
});

// ── A to D: the Foundation assessment allowance ───────────────────────────

test('A. 16 of 34 fundamentals graded, coverage above 80%, must not certify', () => {
  const f = foundationIds(FULL_5);
  const g = {};
  applicableItems(FULL_5).filter((i) => i.meta.weightClass !== 'foundation')
    .forEach((i) => { g[i.id] = { day: { status: 'met' } }; });
  f.slice(0, 16).forEach((id) => { g[id] = { day: { status: 'met' } }; });

  const { s, c } = run(g, FULL_5);
  assert.ok(s.coverage > 80, `coverage ${s.coverage} clears the Certified floor`);
  assert.equal(s.byClass.foundation.score, 100, 'and Foundation reads perfect on what was graded');
  assert.equal(s.foundationUnavailable, 18);
  assert.equal(c.level, 'none', 'this reached Certified before Phase 4C');
  assert.ok(c.reasons.some((r) => /18 of the fundamentals were not assessed/.test(r)), c.reasons.join(' | '));
});

test('B. 4 fundamentals unavailable fails Elite', () => {
  const f = foundationIds(FULL_5);
  const g = gradeAll(FULL_5);
  f.slice(0, 4).forEach((id) => { delete g[id]; });
  const { s, c } = run(g, FULL_5);
  assert.equal(s.foundationUnavailable, 4);
  assert.notEqual(c.level, 'elite');
  assert.equal(c.level, 'none', 'four exceeds even the Certified allowance of 3');
});

test('C. 1 unavailable may reach Exceptional but not Elite', () => {
  const f = foundationIds(FULL_5);
  const g = gradeAll(FULL_5);
  delete g[f[0]];
  const { s, c } = run(g, FULL_5);
  assert.equal(s.foundationUnavailable, 1);
  assert.equal(c.level, 'exceptional');
  const elite = c.evaluations.find((e) => e.level === 'elite');
  assert.ok(elite.failed.includes('fundamentals assessed'), elite.failed.join(','));
});

test('D. 3 unavailable may reach Certified but not Exceptional', () => {
  const f = foundationIds(FULL_5);
  const g = gradeAll(FULL_5);
  f.slice(0, 3).forEach((id) => { delete g[id]; });
  const { s, c } = run(g, FULL_5);
  assert.equal(s.foundationUnavailable, 3);
  assert.equal(c.level, 'certified');
  assert.ok(c.evaluations.find((e) => e.level === 'exceptional').failed.includes('fundamentals assessed'));
});

test('the allowance counts observational and legacy N/A, and reads as incompleteness', () => {
  const f = foundationIds(FULL_5);
  for (const na of [{ status: 'na', naReason: NA_REASON.NOT_OBSERVED }, { status: 'na' }]) {
    const g = gradeAll(FULL_5);
    f.slice(0, 2).forEach((id) => { g[id] = { day: { ...na } }; });
    const { s, c } = run(g, FULL_5);
    assert.equal(s.foundationUnavailable, 2, 'an unobserved fundamental is an unassessed fundamental');
    assert.equal(c.level, 'certified');
  }
});

test('the allowance is exposed on both the score and the certification', () => {
  const g = gradeAll(FULL_5);
  delete g[foundationIds(FULL_5)[0]];
  const { s, c } = run(g, FULL_5);
  assert.equal(s.foundationApplicable, 34);
  assert.equal(s.foundationGraded, 33);
  assert.equal(s.foundationUnavailable, 1);
  assert.equal(s.foundationUnavailableItems.length, 1);
  assert.deepEqual(c.foundationAssessment.eligibleFor, ['certified', 'exceptional']);
  assert.equal(c.foundationAssessmentEligible, true);
  assert.equal(c.measured.foundationUnavailable, 1);
});

// ── E to H: dependency gating removes items rather than excusing them ─────

test('E. no sauna: SP-04 is not applicable and costs no allowance', () => {
  const noSauna = { ...FULL_5, hasSauna: false };
  assert.equal(applicableItems(noSauna).some((i) => i.id === 'SP-04'), false);
  const { s, c } = run(gradeAll(noSauna), noSauna);
  assert.equal(s.foundationApplicable, 33, 'the pool shrinks by one');
  assert.equal(s.foundationUnavailable, 0, 'and nothing is owed for it');
  assert.equal(s.structuralNaShare, 0, 'no N/A was needed at all');
  assert.equal(c.level, 'elite');
});

test('F. no minibar: RM-10 is not applicable and costs no allowance', () => {
  const noMinibar = { ...FULL_5, hasMinibar: false };
  assert.equal(applicableItems(noMinibar).some((i) => i.id === 'RM-10'), false);
  const { s, c } = run(gradeAll(noMinibar), noMinibar);
  assert.equal(s.foundationUnavailable, 0);
  assert.equal(c.level, 'elite');
});

test('G. no changing rooms: SP-02 and SP-03 are not applicable', () => {
  const noChanging = { ...FULL_5, hasChangingRooms: false };
  const ids = applicableItems(noChanging).map((i) => i.id);
  assert.equal(ids.includes('SP-02'), false);
  assert.equal(ids.includes('SP-03'), false);
  const { s, c } = run(gradeAll(noChanging), noChanging);
  assert.equal(s.foundationApplicable, 32);
  assert.equal(s.foundationUnavailable, 0);
  assert.equal(c.level, 'elite');
});

test('H. no gym: all three gym items are not applicable and cost nothing', () => {
  const noGym = { ...FULL_5, hasGym: false };
  const ids = applicableItems(noGym).map((i) => i.id);
  for (const id of ['FAC-04', 'FAC-05', 'FAC-06']) assert.equal(ids.includes(id), false, `${id} should be gone`);
  const { s, c } = run(gradeAll(noGym), noGym);
  assert.equal(s.coverage, 100, 'no coverage penalty');
  assert.equal(s.structuralNaShare, 0, 'no N/A cap consumed');
  assert.equal(s.foundationUnavailable, 0, 'no allowance consumed');
  assert.equal(c.level, 'elite');
});

test('the worst realistic case still reaches Elite', () => {
  // A spa hotel with no sauna, no changing rooms, no minibar, dinner only and
  // no gym. Under the allowance alone this had five unavailable fundamentals
  // and could not certify at all.
  const sparse = {
    ...FULL_5,
    hasSauna: false, hasChangingRooms: false, hasMinibar: false,
    hasLunchService: false, hasGym: false,
  };
  const { s, c } = run(gradeAll(sparse), sparse);
  assert.equal(s.foundationApplicable, 29, 'five fundamentals genuinely do not apply');
  assert.equal(s.foundationUnavailable, 0);
  assert.equal(s.structuralNaShare, 0);
  assert.equal(c.level, 'elite');
});

// ── I: the snapshot still freezes everything ─────────────────────────────

test('I. changing the property after grading starts does not move the audit', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });
  const graded = gradeAll(FULL_5);

  const before = score(graded, resolveScoringProfile(snap, FULL_5).profile);
  const stripped = {
    category: '4★', hasRestaurant: false, hasPool: false, hasSpa: false,
    hasSauna: false, hasChangingRooms: false, hasMinibar: false, hasLunchService: false, hasGym: false,
  };
  const after = score(graded, resolveScoringProfile(snap, stripped).profile);

  assert.equal(after.foundationApplicable, before.foundationApplicable);
  assert.equal(after.weights.applicable, before.weights.applicable);
  assert.equal(after.overall, before.overall);
  assert.equal(certify(after, FULL).level, certify(before, FULL).level);
});

test('a snapshot taken before these flags existed keeps every item', () => {
  const legacy = {
    propertyCategory: '5★',
    facilityProfile: { hasRestaurant: true, hasPool: true, hasSpa: true },
    auditType: AUDIT_TYPE.FULL,
  };
  const resolved = resolveScoringProfile(legacy, {});
  assert.equal(resolved.source, 'snapshot', 'a three flag snapshot is still usable');
  for (const flag of DEPENDENCY_FLAGS) {
    assert.equal(resolved.profile[flag], true, `${flag} must default to present`);
  }
  assert.equal(applicableItems(resolved.profile).length, applicableItems(FULL_5).length,
    'a historical audit loses no applicable item');
});

test('withDependencyDefaults never overrides a recorded false', () => {
  const frozen = withDependencyDefaults({ hasSpa: true, hasSauna: false });
  assert.equal(frozen.hasSauna, false, 'a recorded absence is preserved');
  assert.equal(frozen.hasMinibar, true, 'an absent opinion defaults to present');
  assert.equal(SECTION_FACILITY_FLAGS.length, 3);
  assert.equal(DEPENDENCY_FLAGS.length, 5);
});

// ── J to L: the Spot Audit core ──────────────────────────────────────────

const spot = (scope) => ({ auditType: AUDIT_TYPE.SPOT, scopeSections: scope });

test('J. Room, Bathroom and Safety alone is not enough', () => {
  const scope = ['room', 'bathroom', 'safety'];
  const { c } = run(gradeAll(FULL_5, 'met', { scopeSections: scope }), FULL_5, spot(scope), { scopeSections: scope });
  assert.equal(c.level, 'none');
  assert.equal(c.spotScope.missingCore.length, 0, 'the core is present');
  assert.equal(c.spotScope.additional, 0);
  assert.ok(c.reasons.some((r) => /at least 2 areas beyond the required three/.test(r)), c.reasons.join(' | '));
});

test('K. the core plus two more areas is eligible', () => {
  const scope = ['room', 'bathroom', 'safety', 'arrival', 'housekeeping'];
  const { s, c } = run(gradeAll(FULL_5, 'met', { scopeSections: scope }), FULL_5, spot(scope), { scopeSections: scope });
  assert.equal(s.coverage, 100, 'measured against its declared scope');
  assert.equal(c.spotScope.eligible, true);
  assert.equal(c.level, 'certified');
  assert.equal(c.ceiling, 'certified', 'a Spot Audit still cannot exceed Certified');
});

test('L. a high scoring Spot Audit missing Bathroom cannot certify', () => {
  const scope = ['room', 'safety', 'arrival', 'reception', 'housekeeping'];
  const { s, c } = run(gradeAll(FULL_5, 'met', { scopeSections: scope }), FULL_5, spot(scope), { scopeSections: scope });
  assert.equal(s.overall, 100);
  assert.equal(s.coverage, 100);
  assert.equal(c.level, 'none', 'a flawless score cannot buy a missing core section');
  assert.deepEqual(c.spotScope.missingCore, ['bathroom']);
  assert.ok(c.reasons.some((r) => /must include Bathroom/.test(r)), c.reasons.join(' | '));
});

test('the Phase 4C exploit scopes are all refused', () => {
  for (const scope of [['pre', 'reception', 'departure'], ['pre', 'lunch'], ['pre', 'breakfast', 'lunch']]) {
    const { c } = run(gradeAll(FULL_5, 'met', { scopeSections: scope }), FULL_5, spot(scope), { scopeSections: scope });
    assert.equal(c.level, 'none', scope.join('+'));
    assert.ok(c.spotScope.missingCore.length > 0);
  }
});

test('the core rule touches nothing but Spot Audits', () => {
  assert.equal(spotScopeEligibility(AUDIT_TYPE.FULL, null).applies, false);
  assert.equal(spotScopeEligibility(AUDIT_TYPE.FULL, ['pre']).eligible, true);
  assert.equal(spotScopeEligibility(AUDIT_TYPE.DESK, ['pre']).eligible, true);
  // A Full Audit is unaffected in the engine too.
  const { c } = run(gradeAll(FULL_5), FULL_5, FULL);
  assert.equal(c.level, 'elite');
  assert.equal(c.spotScope.applies, false);
});

test('a Spot Audit that declared no scope is judged against the whole property', () => {
  const e = spotScopeEligibility(AUDIT_TYPE.SPOT, null);
  assert.equal(e.eligible, true);
  assert.equal(e.undeclared, true);
  assert.deepEqual(SPOT_CORE_SECTIONS, ['room', 'bathroom', 'safety']);
  assert.equal(SPOT_MIN_ADDITIONAL_SECTIONS, 2);
});

// ── False failure review across real property profiles ───────────────────

test('no honest property profile is refused on a flawless audit', () => {
  const profiles = {
    '4 star rooms only': { category: '4★', hasRestaurant: false, hasPool: false, hasSpa: false, hasMinibar: false, hasGym: false },
    '5 star full service': FULL_5,
    'Ultra full service': { ...FULL_5, category: 'Ultra' },
    'spa but no sauna': { ...FULL_5, hasSauna: false },
    'spa but no changing rooms': { ...FULL_5, hasChangingRooms: false },
    'restaurant, dinner only': { ...FULL_5, hasLunchService: false },
    'no minibar': { ...FULL_5, hasMinibar: false },
    'no gym': { ...FULL_5, hasGym: false },
  };
  for (const [label, profile] of Object.entries(profiles)) {
    const { s, c } = run(gradeAll(profile), profile);
    assert.equal(s.foundationUnavailable, 0, `${label}: nothing should be owed`);
    assert.equal(s.structuralNaShare, 0, `${label}: no N/A should be needed`);
    assert.equal(s.coverage, 100, `${label}: no coverage penalty`);
    const expected = profile.category === '4★' ? 'exceptional' : 'elite';
    assert.equal(c.level, expected, `${label}: expected ${expected}`);
  }
});

test('the allowance behaves identically at every profile', () => {
  const profiles = [
    { category: '4★', hasRestaurant: true, hasPool: true, hasSpa: true },
    FULL_5,
    { ...FULL_5, category: 'Ultra' },
    { category: '5★', hasRestaurant: false, hasPool: false, hasSpa: false },
    { ...FULL_5, hasSauna: false, hasGym: false },
  ];
  for (const profile of profiles) {
    const f = foundationIds(profile);
    for (const [k, expectEligible] of [[0, true], [1, true], [3, true], [4, false]]) {
      const g = gradeAll(profile);
      f.slice(0, k).forEach((id) => { delete g[id]; });
      const { s, c } = run(g, profile);
      assert.equal(s.foundationUnavailable, k);
      assert.equal(
        c.foundationAssessmentEligible, expectEligible,
        `${profile.category} with ${k} unavailable`,
      );
      if (k === 4) assert.equal(c.level, 'none');
    }
  }
});

// ── M: regression on the real published audit ────────────────────────────

test('M. AHP-2026-8B10 regression', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fx = JSON.parse(fs.readFileSync(path.join(here, '../src/framework/__fixtures__/audit-AHP-2026-8B10.json'), 'utf8'));
  const graded = {};
  for (const [id, byShift] of Object.entries(fx.statuses)) {
    graded[id] = {};
    for (const [shiftId, status] of Object.entries(byShift)) graded[id][shiftId] = { status };
  }
  // The property record predates the dependency flags, so every one defaults
  // to present and the audit keeps exactly the items it was scored against.
  const s = score(graded, fx.property);
  const c = certify(s, { auditType: fx.tier });

  assert.equal(s.overall, 74.1, 'unchanged');
  assert.equal(s.coverage, 71.2, 'unchanged');
  assert.equal(s.byClass.foundation.score, 87.5, 'unchanged');
  assert.deepEqual(s.findingCounts, { minor: 30, major: 3, critical: 1, zero_tolerance: 0 }, 'unchanged');
  assert.equal(s.foundationApplicable, 27, 'no gate removed an item, the flags default to present');
  assert.equal(s.foundationGraded, 16);
  assert.equal(s.foundationUnavailable, 11);
  assert.equal(c.level, 'none', 'still not certified');
  // The allowance is now a further reason, on top of the three it already had.
  assert.ok(c.reasons.some((r) => /11 of the fundamentals were not assessed/.test(r)), c.reasons.join(' | '));
});

// ── Phase 5.1: version stamping and the three flag states ────────────────

test('a new snapshot is stamped with the current framework and checklist', () => {
  const snap = buildSnapshot(FULL_5, { auditType: AUDIT_TYPE.FULL });
  assert.equal(snap.frameworkVersion, FRAMEWORK_VERSION);
  assert.equal(snap.checklistVersion, CHECKLIST_VERSION);
  assert.equal(snap.frameworkVersion, '1.3.0');
  assert.equal(snap.checklistVersion, '1.2.0');
  // The version constants live in exactly one place and travel from there.
  assert.equal(FRAMEWORK.frameworkVersion, FRAMEWORK_VERSION);
  assert.equal(FRAMEWORK.checklistVersion, CHECKLIST_VERSION);
});

test('an existing snapshot keeps the version it was stamped with', () => {
  // An audit recorded under an older framework must read back as that
  // framework, or the stamp is worthless.
  const old = {
    propertyCategory: '5★',
    facilityProfile: { hasRestaurant: true, hasPool: true, hasSpa: true },
    auditType: AUDIT_TYPE.FULL,
    frameworkVersion: '1.0.0',
    checklistVersion: '1.0.0',
  };
  const resolved = resolveScoringProfile(old, FULL_5);
  assert.equal(resolved.frameworkVersion, '1.0.0', 'never rewritten to the current version');
  assert.equal(resolved.checklistVersion, '1.0.0');
  assert.equal(old.frameworkVersion, '1.0.0', 'and the snapshot object itself is not mutated');
});

test('an audit with no snapshot records no version at all', () => {
  const resolved = resolveScoringProfile(null, FULL_5);
  assert.equal(resolved.source, 'live-property-fallback');
  assert.equal(resolved.frameworkVersion, null, 'a reconstructed basis must not claim a version');
  assert.equal(resolved.checklistVersion, null);
});

test('a flag has three states and only false gates the item out', () => {
  const base = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
  const has = (profile, id) => applicableItems(profile).some((i) => i.id === id);

  for (const [id, flag] of [
    ['SP-04', 'hasSauna'], ['SP-02', 'hasChangingRooms'], ['RM-10', 'hasMinibar'],
    ['LUN-02', 'hasLunchService'], ['FAC-04', 'hasGym'],
  ]) {
    assert.equal(has({ ...base }, id), true, `${id}: absent flag reads as present`);
    assert.equal(has({ ...base, [flag]: null }, id), true, `${id}: null reads as present`);
    assert.equal(has({ ...base, [flag]: undefined }, id), true, `${id}: undefined reads as present`);
    assert.equal(has({ ...base, [flag]: true }, id), true, `${id}: true keeps the item`);
    assert.equal(has({ ...base, [flag]: false }, id), false, `${id}: only false removes it`);
  }
});

// ── Phase 5.2: an unknown flag survives being snapshotted ──────────────────
//
// buildSnapshot used Boolean() on every flag, so null and undefined were
// frozen as false. isApplicable gates on an explicit false, so the moment an
// audit locked, five fundamentals nobody had ever been asked about dropped out
// of it. The live property read them as present; its own snapshot did not.

test('a null flag is stamped into a snapshot as present, not as null', () => {
  const prop = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true, hasSauna: null };
  const snap = buildSnapshot(prop, FULL);
  assert.equal(snap.facilityProfile.hasSauna, true, 'unknown is not absent');
  assert.equal(typeof snap.facilityProfile.hasSauna, 'boolean', 'and it is stored as a boolean');
});

test('an unknown flag is not a recorded absence, in any of its forms', () => {
  const base = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
  for (const state of [undefined, null]) {
    const snap = buildSnapshot({ ...base, hasGym: state }, FULL);
    assert.equal(snap.facilityProfile.hasGym, true, `${String(state)} must freeze as present`);
  }
  assert.equal(buildSnapshot(base, FULL).facilityProfile.hasGym, true, 'absent must freeze as present');
  assert.equal(buildSnapshot({ ...base, hasGym: false }, FULL).facilityProfile.hasGym, false,
    'a recorded absence is the only thing that freezes as absent');
});

test('a section flag still freezes on presence, not on absence', () => {
  // The three section flags are not-null in the schema and have always been
  // answered, so absent genuinely means no. Only the dependency flags carry
  // the three-state meaning.
  const snap = buildSnapshot({ category: '5★', hasRestaurant: true }, FULL);
  assert.equal(snap.facilityProfile.hasRestaurant, true);
  assert.equal(snap.facilityProfile.hasPool, false);
  assert.equal(snap.facilityProfile.hasSpa, false);
});

test('a property and its own snapshot agree on every item, in every flag state', () => {
  const base = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
  const idsOf = (profile) => applicableItems(profile).map((i) => i.id);
  const foundationCount = (profile) => foundationIds(profile).length;

  for (const flag of DEPENDENCY_FLAGS) {
    for (const state of ['absent', null, undefined, true, false]) {
      const prop = state === 'absent' ? { ...base } : { ...base, [flag]: state };
      const viaSnapshot = resolveScoringProfile(buildSnapshot(prop, FULL), prop).profile;

      assert.deepEqual(
        idsOf(viaSnapshot), idsOf(prop),
        `${flag}=${String(state)}: the snapshot must select what the property selects`,
      );
      assert.equal(
        foundationCount(viaSnapshot), foundationCount(prop),
        `${flag}=${String(state)}: the Foundation denominator must not move`,
      );
    }
  }
});

test('a recorded false still removes its dependent item through the snapshot', () => {
  const cases = [
    ['hasSauna', ['SP-04']],
    ['hasChangingRooms', ['SP-02', 'SP-03']],
    ['hasMinibar', ['RM-10']],
    ['hasLunchService', ['LUN-02']],
    ['hasGym', ['FAC-04', 'FAC-05', 'FAC-06']],
  ];
  for (const [flag, gatedIds] of cases) {
    const prop = { ...FULL_5, [flag]: false };
    const viaSnapshot = resolveScoringProfile(buildSnapshot(prop, FULL), prop).profile;
    const ids = new Set(applicableItems(viaSnapshot).map((i) => i.id));
    for (const id of gatedIds) {
      assert.equal(ids.has(id), false, `${flag}=false must remove ${id} through the snapshot too`);
    }
  }
});

test('an all-unknown property keeps its full audit once locked', () => {
  // The state of all seven production properties today: nobody has been asked
  // about any of the five. Locking an audit must not shrink it.
  const unknown = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
  const live = applicableItems(unknown);
  const frozen = applicableItems(resolveScoringProfile(buildSnapshot(unknown, FULL), unknown).profile);
  assert.equal(frozen.length, live.length);
  assert.equal(frozen.length, 133, '5★ with every facility carries 133 of the 147 items');
  assert.equal(
    frozen.filter((i) => i.meta.weightClass === 'foundation').length, 34,
    'and all 34 fundamentals',
  );
});
