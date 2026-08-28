// Phase 3B: the live capture checklist and the framework catalogue are one
// list. These tests exist to fail loudly if they ever diverge again.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SECTIONS } from '../src/auditItems.js';
import { CATALOG_SECTIONS, catalogItems, applicableItems } from '../src/framework/catalog.js';
import { ITEM_META } from '../src/framework/items.js';
import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { CLASS_WEIGHT, SEVERITY, AUDIT_TYPE } from '../src/framework/weights.js';
import { FRAMEWORK } from '../src/framework/version.js';

const liveIds = () => SECTIONS.flatMap((s) => s.items.map((i) => i.id));

test('the live checklist holds exactly 147 items across 15 sections', () => {
  assert.equal(SECTIONS.length, 15);
  assert.equal(liveIds().length, 147);
});

test('the framework catalogue is the live checklist, not a copy of it', () => {
  assert.equal(CATALOG_SECTIONS, SECTIONS, 'same object, so they cannot drift');
  assert.equal(catalogItems().length, 147);
});

test('live and framework ids match one for one, in the same order', () => {
  const live = liveIds();
  const catalogue = catalogItems().map((i) => i.id);
  assert.deepEqual(catalogue, live);
  assert.equal(new Set(live).size, live.length, 'no duplicate ids');
});

test('every item has metadata and every metadata entry has an item', () => {
  const live = liveIds();
  assert.deepEqual(Object.keys(ITEM_META).slice().sort(), live.slice().sort());
  assert.equal(live.filter((id) => !ITEM_META[id]).length, 0, 'no unmapped items');
  assert.equal(Object.keys(ITEM_META).filter((id) => !live.includes(id)).length, 0, 'no orphan metadata');
});

test('no staging mechanism survives the promotion', async () => {
  await assert.rejects(
    () => import('../src/framework/additions.js'),
    'additions.js must be gone: two definitions of the same item is the drift this phase removed',
  );
});

// ── The new section ────────────────────────────────────────────────────────

test('the fifteenth section is Safety, Security & Integrity, placed after Facilities', () => {
  const ids = SECTIONS.map((s) => s.id);
  const safety = SECTIONS.find((s) => s.id === 'safety');
  assert.ok(safety, 'the safety section exists');
  assert.equal(safety.label, 'Safety, Security & Integrity');
  assert.equal(safety.facility, null, 'assessed at every property');
  assert.equal(ids.indexOf('safety'), ids.indexOf('facilities') + 1);
  assert.deepEqual(safety.items.map((i) => i.id), ['SAF-01', 'SAF-02', 'SAF-03']);
  // Shaped like every other section, so the existing navigation and capture
  // rendering pick it up with no special casing.
  for (const key of ['id', 'label', 'icon', 'facility', 'items']) {
    assert.ok(key in safety, `section is missing ${key}`);
  }
});

// ── The five promoted items ────────────────────────────────────────────────

const EXPECTED = {
  'SAF-01': { section: 'safety', weightClass: 'foundation', dimension: 'condition', defaultSeverity: SEVERITY.CRITICAL, zt: true },
  'SAF-02': { section: 'safety', weightClass: 'foundation', dimension: 'condition', defaultSeverity: SEVERITY.CRITICAL, zt: true },
  'SAF-03': { section: 'safety', weightClass: 'foundation', dimension: 'service', defaultSeverity: SEVERITY.CRITICAL, zt: true },
  'REC-11': { section: 'reception', weightClass: 'foundation', dimension: 'service', defaultSeverity: SEVERITY.MAJOR, zt: true },
  'SP-13': { section: 'spa', weightClass: 'foundation', dimension: 'service', defaultSeverity: SEVERITY.CRITICAL, zt: true },
};

test('the five promoted items kept the metadata they were approved with', () => {
  const index = new Map(catalogItems().map((i) => [i.id, i]));
  for (const [id, want] of Object.entries(EXPECTED)) {
    const item = index.get(id);
    assert.ok(item, `${id} is in the catalogue`);
    assert.equal(item.sectionId, want.section, `${id} section`);
    assert.equal(item.minStars, 4, `${id} minStars`);
    assert.equal(item.meta.weightClass, want.weightClass, `${id} weight class`);
    assert.equal(item.weight, CLASS_WEIGHT[want.weightClass], `${id} weight`);
    assert.equal(item.meta.dimension, want.dimension, `${id} dimension`);
    assert.equal(item.meta.defaultSeverity, want.defaultSeverity, `${id} default severity`);
    assert.equal(item.meta.zeroToleranceEligible, want.zt, `${id} Zero Tolerance eligibility`);
    assert.ok(item.label.length > 20, `${id} carries its full label`);
  }
});

test('SP-13 stays behind the spa gate, the other four are always assessed', () => {
  const index = new Map(catalogItems().map((i) => [i.id, i]));
  assert.equal(index.get('SP-13').facility, 'hasSpa');
  for (const id of ['SAF-01', 'SAF-02', 'SAF-03', 'REC-11']) {
    assert.equal(index.get(id).facility, null, `${id} has no facility gate`);
  }
  // A property with no spa never sees SP-13 in any denominator.
  const noSpa = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: false };
  assert.equal(applicableItems(noSpa).some((i) => i.id === 'SP-13'), false);
});

// ── Totals, recalculated from source ───────────────────────────────────────

test('class, dimension and severity totals recalculate to the framework contract', () => {
  const items = catalogItems();
  const tally = (pick) => items.reduce((acc, i) => {
    const k = pick(i);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(tally((i) => i.meta.weightClass), { foundation: 34, standard: 83, distinction: 30 });
  assert.deepEqual(tally((i) => i.meta.dimension), { condition: 35, service: 47, product: 44, experience: 21 });
  assert.deepEqual(tally((i) => i.meta.defaultSeverity), { minor: 93, major: 36, critical: 18 });

  assert.equal(items.filter((i) => i.meta.zeroToleranceEligible).length, 20);
  assert.equal(items.reduce((a, i) => a + i.weight, 0), FRAMEWORK.expectedTheoreticalWeight);
  assert.equal(items.reduce((a, i) => a + i.weight, 0), 298);

  // Foundation grew by the five promoted items and nothing else moved.
  assert.equal(items.filter((i) => i.meta.weightClass === 'foundation').length * 3, 102);
});

test('no item defaults to Zero Tolerance, including the promoted ones', () => {
  for (const item of catalogItems()) {
    assert.notEqual(item.meta.defaultSeverity, SEVERITY.ZERO_TOLERANCE, `${item.id} must not default to Zero Tolerance`);
  }
});

// ── Scoring against the full catalogue ─────────────────────────────────────

const FULL_5 = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
const gradeAll = (profile, status) => {
  const graded = {};
  for (const item of applicableItems(profile)) graded[item.id] = { day: { status } };
  return graded;
};

test('coverage reaches 100% now that every catalogue item can be captured', () => {
  const r = score(gradeAll(FULL_5, 'met'), FULL_5);
  assert.equal(r.coverage, 100, 'no item is left unreachable by the capture UI');
  assert.equal(r.overall, 100);
  assert.equal(r.counts.applicable, r.counts.graded);
});

test('the five new items carry real weight in the denominator', () => {
  const withAll = score(gradeAll(FULL_5, 'met'), FULL_5);
  // Five Foundation items at weight 3, less SP-13 where there is no spa.
  const noSpa = { ...FULL_5, hasSpa: false };
  const spaWeight = score(gradeAll(FULL_5, 'met'), FULL_5).weights.applicable
    - score(gradeAll(noSpa, 'met'), noSpa).weights.applicable;
  assert.ok(spaWeight > 0, 'the spa section still carries weight');
  assert.equal(withAll.weights.applicable, 284, '5★ with every facility');
});

test('a missed SAF item raises a Critical finding and blocks certification', () => {
  for (const id of ['SAF-01', 'SAF-02', 'SAF-03', 'SP-13']) {
    const graded = { ...gradeAll(FULL_5, 'met'), [id]: { day: { status: 'missed' } } };
    const s = score(graded, FULL_5);
    const c = certify(s, { auditType: AUDIT_TYPE.FULL });
    assert.equal(s.findingCounts.critical, 1, `${id} raises one Critical finding`);
    assert.equal(c.level, 'none', `${id} blocks certification`);
    assert.ok(c.blockers.some((b) => b.includes(id)), `${id} is named as a blocker`);
  }
});

test('a missed REC-11 raises a Major finding and does not block on its own', () => {
  const graded = { ...gradeAll(FULL_5, 'met'), 'REC-11': { day: { status: 'missed' } } };
  const s = score(graded, FULL_5);
  const c = certify(s, { auditType: AUDIT_TYPE.FULL });
  assert.equal(s.findingCounts.major, 1);
  assert.equal(s.findingCounts.critical, 0);
  assert.deepEqual(c.blockers, []);
  assert.equal(c.eligible, true, 'Major alone does not block in v1');
});

test('a partial on a promoted Critical item stays Critical', () => {
  const graded = { ...gradeAll(FULL_5, 'met'), 'SAF-01': { day: { status: 'partial' } } };
  const s = score(graded, FULL_5);
  assert.equal(s.findingCounts.critical, 1);
  assert.equal(s.findingCounts.major, 0);
  assert.equal(certify(s, { auditType: AUDIT_TYPE.FULL }).level, 'none');
});

test('the promoted items are Zero Tolerance eligible and validate as such', () => {
  const index = new Map(catalogItems().map((i) => [i.id, i]));
  for (const id of Object.keys(EXPECTED)) {
    const graded = {
      [id]: {
        day: {
          status: 'missed',
          escalation: { severity: SEVERITY.ZERO_TOLERANCE, note: 'observed', evidence: 'photo.jpg' },
        },
      },
    };
    const profile = index.get(id).facility === 'hasSpa' ? FULL_5 : FULL_5;
    const s = score(graded, profile);
    assert.equal(s.zeroToleranceTriggered, true, `${id} can be escalated`);
    assert.deepEqual(s.zeroToleranceItems, [id]);
    assert.equal(s.escalationErrors.length, 0, `${id} escalation is valid`);
  }
});
