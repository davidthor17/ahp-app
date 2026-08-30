// Phase 5.2 — capture / scoring parity.
//
// The capture screen and the scoring engine must agree about which items
// belong to an audit. They did not. Scoring read the frozen snapshot while the
// checklist read the live property, so editing the property mid-audit hid
// items that still counted against the result.
//
// These tests model the capture screen's selection exactly as App.jsx performs
// it — resolveScoringProfile, then SECTIONS filtered on that profile, then
// isApplicable per item — and assert it against the engine's own denominator.
// If App.jsx ever drifts back to reading the live property, captureModel here
// stays honest and the assertions still describe the contract that was broken.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SECTIONS } from '../src/auditItems.js';
import { applicableItems, catalogIndex, isApplicable } from '../src/framework/catalog.js';
import { buildSnapshot, resolveScoringProfile } from '../src/framework/snapshot.js';
import { score } from '../src/framework/scoring.js';
import { AUDIT_TYPE, WEIGHT_CLASS } from '../src/framework/weights.js';

const INDEX = catalogIndex();

/** What the checklist shows, expressed the way App.jsx expresses it. */
function captureModel(basis) {
  const { profile, scopeSections } = basis;
  const sections = SECTIONS.filter((s) => !s.facility || profile[s.facility]);
  const reachable = [];
  for (const section of sections) {
    for (const item of section.items) {
      // catalogIndex carries the joined item; a raw SECTIONS item does not
      // know its own section, which isApplicable needs for scope.
      const joined = INDEX.get(item.id);
      if (joined && isApplicable(joined, profile, scopeSections)) reachable.push(item.id);
    }
  }
  return { sections: sections.length, reachable };
}

/** What the engine counts. */
function scoringModel(basis) {
  const items = applicableItems(basis.profile, { scopeSections: basis.scopeSections });
  return {
    applicable: items.map((i) => i.id),
    foundation: items.filter((i) => i.meta.weightClass === WEIGHT_CLASS.FOUNDATION).length,
  };
}

const FULL_5 = Object.freeze({
  category: '5★',
  hasRestaurant: true, hasPool: true, hasSpa: true,
  hasSauna: true, hasChangingRooms: true, hasMinibar: true,
  hasLunchService: true, hasGym: true,
});

// Every flag knocked out, which is the edit an auditor could make mid-audit.
const STRIPPED = Object.freeze({
  category: '4★',
  hasRestaurant: false, hasPool: false, hasSpa: false,
  hasSauna: false, hasChangingRooms: false, hasMinibar: false,
  hasLunchService: false, hasGym: false,
});

// The eight items gated by a `requires` flag.
const GATED_ITEMS = Object.freeze([
  'SP-04', 'SP-02', 'SP-03', 'RM-10', 'LUN-02', 'FAC-04', 'FAC-05', 'FAC-06',
]);

function lockedSnapshot(prop = FULL_5) {
  return buildSnapshot(prop, { auditType: AUDIT_TYPE.FULL, lockedAt: '2026-08-29T10:00:00Z' });
}

function scenarios() {
  const locked = lockedSnapshot();
  // A property nobody has been asked about: the five dependency flags absent.
  const unknown = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
  // Three recorded as genuinely absent.
  const someFalse = { ...FULL_5, hasSauna: false, hasMinibar: false, hasGym: false };

  return [
    ['1. new audit, no snapshot', resolveScoringProfile(null, FULL_5)],
    ['2. snapshot locked, property unchanged', resolveScoringProfile(locked, FULL_5)],
    ['3. snapshot locked, live category changed', resolveScoringProfile(locked, { ...FULL_5, category: '4★' })],
    ['4. snapshot locked, every live flag false', resolveScoringProfile(locked, STRIPPED)],
    ['5. snapshot from unknown flags', resolveScoringProfile(lockedSnapshot(unknown), unknown)],
    ['6. snapshot from explicit false flags', resolveScoringProfile(lockedSnapshot(someFalse), someFalse)],
    ['7. legacy audit, no snapshot at all', resolveScoringProfile(undefined, FULL_5)],
  ];
}

test('capture and scoring select the same items, in every scenario', () => {
  for (const [label, basis] of scenarios()) {
    const capture = captureModel(basis);
    const scoring = scoringModel(basis);
    assert.deepEqual(
      capture.reachable, scoring.applicable,
      `${label}: the checklist and the denominator must hold the same items`,
    );
  }
});

test('every item in the scoring denominator is reachable in capture', () => {
  // The invariant that matters most. An item must not count against an audit
  // the auditor has no way to reach.
  for (const [label, basis] of scenarios()) {
    const reachable = new Set(captureModel(basis).reachable);
    for (const id of scoringModel(basis).applicable) {
      assert.ok(reachable.has(id), `${label}: ${id} counts but cannot be reached`);
    }
  }
});

test('no item hidden by a requires gate stays in the denominator', () => {
  const gated = {
    ...FULL_5,
    hasSauna: false, hasChangingRooms: false, hasMinibar: false,
    hasLunchService: false, hasGym: false,
  };
  const basis = resolveScoringProfile(lockedSnapshot(gated), gated);
  const reachable = new Set(captureModel(basis).reachable);
  const applicable = new Set(scoringModel(basis).applicable);
  for (const id of GATED_ITEMS) {
    assert.equal(reachable.has(id), false, `${id} must be hidden in capture`);
    assert.equal(applicable.has(id), false, `${id} must be out of the denominator`);
  }
});

test('a locked snapshot does not move when the live property is rewritten', () => {
  const locked = lockedSnapshot();
  const before = captureModel(resolveScoringProfile(locked, FULL_5));
  const after = captureModel(resolveScoringProfile(locked, STRIPPED));

  assert.equal(after.sections, before.sections, 'no section leaves the checklist');
  assert.deepEqual(after.reachable, before.reachable, 'no item leaves the checklist');

  const sBefore = scoringModel(resolveScoringProfile(locked, FULL_5));
  const sAfter = scoringModel(resolveScoringProfile(locked, STRIPPED));
  assert.equal(sAfter.applicable.length, sBefore.applicable.length);
  assert.equal(sAfter.foundation, sBefore.foundation, 'the Foundation denominator holds');
  assert.equal(sAfter.foundation, 34);
});

test('before the lock the live property still steers the checklist', () => {
  // Setup has to stay editable until grading starts, and does.
  const full = captureModel(resolveScoringProfile(null, FULL_5));
  const noSpa = captureModel(resolveScoringProfile(null, { ...FULL_5, hasSpa: false }));
  assert.equal(full.sections, 15);
  assert.equal(noSpa.sections, 14);
  assert.ok(noSpa.reachable.length < full.reachable.length);
});

test('recorded scenario counts, so a regression is visible', () => {
  const rows = scenarios().map(([label, basis]) => {
    const c = captureModel(basis);
    const s = scoringModel(basis);
    return {
      label,
      sections: c.sections,
      reachable: c.reachable.length,
      applicable: s.applicable.length,
      foundation: s.foundation,
    };
  });

  for (const r of rows) {
    assert.equal(r.reachable, r.applicable, `${r.label}: capture ${r.reachable} vs scoring ${r.applicable}`);
  }

  const [, two, three, four, five, six] = rows;
  // 2, 3 and 4 share one locked snapshot, so they must be identical.
  assert.deepEqual(
    [three.reachable, four.reachable, three.foundation, four.foundation],
    [two.reachable, two.reachable, two.foundation, two.foundation],
  );
  // Unknown flags must behave as present, or a historical audit loses items.
  assert.equal(five.applicable, two.applicable, 'unknown must read as present');
  assert.equal(five.foundation, two.foundation);
  // Three recorded absences remove exactly five items: sauna, minibar, 3 gym.
  assert.equal(two.applicable - six.applicable, 5);
});

test('a full 5★ audit under a locked snapshot scores what capture offered', () => {
  const locked = lockedSnapshot();
  // The property is edited down to nothing after the lock.
  const basis = resolveScoringProfile(locked, STRIPPED);

  const graded = {};
  for (const id of captureModel(basis).reachable) graded[id] = { day: { status: 'met' } };

  const s = score(graded, basis.profile, { scopeSections: basis.scopeSections });
  assert.equal(s.coverage, 100, 'grading everything the checklist offers reaches full coverage');
  assert.equal(s.foundationUnavailable, 0, 'and owes nothing on the fundamentals');
  assert.equal(s.counts.applicable, s.counts.graded);
  // 133 of the 147 catalogue items apply at 5★; the rest are Ultra-only.
  assert.equal(s.counts.applicable, 133, 'the frozen 5★ basis keeps every item it had');
});

test('a Spot Audit scope narrows capture and scoring together', () => {
  const scope = ['room', 'bathroom', 'safety', 'reception', 'breakfast'];
  const snapshot = buildSnapshot(FULL_5, {
    auditType: AUDIT_TYPE.SPOT,
    scopeSections: scope,
    lockedAt: '2026-08-29T10:00:00Z',
  });
  const basis = resolveScoringProfile(snapshot, FULL_5);
  const capture = captureModel(basis);
  const scoring = scoringModel(basis);

  assert.deepEqual(capture.reachable, scoring.applicable);
  // Sections outside the scope still render — a Spot Audit narrows the items,
  // not the navigation — but nothing inside them is reachable or counted.
  const inScope = new Set(scope);
  for (const section of SECTIONS) {
    if (inScope.has(section.id)) continue;
    for (const item of section.items) {
      assert.equal(capture.reachable.includes(item.id), false, `${item.id} is out of scope`);
      assert.equal(scoring.applicable.includes(item.id), false, `${item.id} is out of scope`);
    }
  }
});
