// Phase 5.5 — the frozen public representation of a published audit.
//
// The payload is the whole guarantee: once it is written, the public report
// renders it and reads nothing else. So these tests care about two things.
// That it says exactly what the public page used to compute, so publishing
// changes no number. And that it is complete enough to render alone, because a
// reader that has to fall back to live data has lost the guarantee.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublishedResult, validatePublishedResult, isValidPublishedResult,
  worstStatusByItem, sectionBreakdown, publicScore, meetsStandard, marksAudit, basisFor,
  PUBLISHED_RESULT_VERSION, PASS_THRESHOLD,
} from '../src/framework/publishedResult.js';
import { SECTIONS } from '../src/auditItems.js';
import { buildSnapshot, resolveScoringProfile, SNAPSHOT_STATUS } from '../src/framework/snapshot.js';
import { AUDIT_TYPE } from '../src/framework/weights.js';

const PROP = {
  name: 'Hotel Borealis', city: 'Reykjavik', country: 'Iceland', category: '5★',
  hasRestaurant: true, hasPool: true, hasSpa: true,
};

const PUBLISHED_AT = '2026-09-14T10:22:41.108Z';
const AUDITED_ON = '2026-09-12';

const g = (status) => ({ day: { status } });

function baseInput(overrides = {}) {
  return {
    prop: PROP,
    graded: { 'RM-01': g('met'), 'RM-02': g('met'), 'RM-03': g('missed') },
    auditType: 'full',
    criticalFailures: [],
    scoringBasis: resolveScoringProfile(
      buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL, lockedAt: '2026-09-12T08:14:00.000Z' }),
      PROP, SNAPSHOT_STATUS.FROZEN,
    ),
    auditedOn: AUDITED_ON,
    publishedAt: PUBLISHED_AT,
    ...overrides,
  };
}

// ── worst status ───────────────────────────────────────────────────────────

test('the worst status across shifts is the one that counts', () => {
  const worst = worstStatusByItem({
    'RM-01': { day: { status: 'met' }, night: { status: 'missed' } },
    'RM-02': { day: { status: 'partial' }, night: { status: 'met' } },
    'RM-03': { day: { status: 'na' }, night: { status: 'met' } },
    'RM-04': { day: { status: 'met' } },
  });
  assert.equal(worst.get('RM-01'), 'missed');
  assert.equal(worst.get('RM-02'), 'partial');
  assert.equal(worst.get('RM-03'), 'na', 'na is worse than met and better than partial');
  assert.equal(worst.get('RM-04'), 'met');
});

test('an item with no status anywhere is not counted', () => {
  const worst = worstStatusByItem({ 'RM-01': { day: {} }, 'RM-02': { day: { note: 'looked' } }, 'RM-03': {} });
  assert.equal(worst.size, 0);
});

// ── score ──────────────────────────────────────────────────────────────────

test('the public score is met over everything graded, N/A excluded', () => {
  const s = publicScore({
    'RM-01': g('met'), 'RM-02': g('met'), 'RM-03': g('partial'),
    'RM-04': g('missed'), 'RM-05': g('na'),
  });
  assert.equal(s.itemsMet, 2);
  assert.equal(s.itemsGraded, 4, 'na leaves the denominator');
  assert.equal(s.percent, 50);
});

test('an audit with nothing graded scores null, not zero', () => {
  const s = publicScore({});
  assert.equal(s.percent, null);
  assert.equal(s.itemsGraded, 0);
});

test('the payload score matches what the public report computed before', () => {
  // The exact arithmetic report.js line 97 performed: round(met / graded * 100).
  const graded = {};
  for (let i = 1; i <= 81; i++) graded[`X-${i}`] = g(i <= 47 ? 'met' : 'partial');
  assert.equal(publicScore(graded).percent, Math.round((47 / 81) * 100));
  assert.equal(publicScore(graded).percent, 58, 'the figure AHP-2026-8B10 shows today');
});

// ── sections ───────────────────────────────────────────────────────────────

test('sections carry their own label and come out in checklist order', () => {
  const rows = sectionBreakdown({ 'DEP-01': g('met'), 'PRE-01': g('met'), 'RM-01': g('met') });
  assert.deepEqual(rows.map((r) => r.id), ['pre', 'room', 'departure']);
  assert.equal(rows[0].label, 'Pre-Arrival & Website');
  assert.equal(rows[1].label, 'Room Quality');
});

test('all fifteen sections survive into the payload, facilities and safety included', () => {
  // The 13-section map in report.js counted these two toward the headline
  // figure and then dropped them from the breakdown.
  const graded = {};
  for (const section of SECTIONS) graded[section.items[0].id] = g('met');

  const rows = sectionBreakdown(graded);
  assert.equal(rows.length, 15);
  assert.deepEqual(rows.map((r) => r.id), SECTIONS.map((s) => s.id));
  assert.ok(rows.some((r) => r.id === 'facilities'), 'facilities is present');
  assert.ok(rows.some((r) => r.id === 'safety'), 'safety is present');
  for (const row of rows) assert.ok(row.label && row.label !== row.id, `${row.id} has a real label`);
});

test('section counts add up to the total and match the score', () => {
  const graded = {
    'RM-01': g('met'), 'RM-02': g('partial'), 'RM-03': g('missed'), 'RM-04': g('na'),
    'PRE-01': g('met'),
  };
  const rows = sectionBreakdown(graded);
  const room = rows.find((r) => r.id === 'room');
  assert.deepEqual(
    { total: room.total, met: room.met, partial: room.partial, missed: room.missed, na: room.na },
    { total: 4, met: 1, partial: 1, missed: 1, na: 1 },
  );
  const total = rows.reduce((a, r) => a + r.total, 0);
  const graded_ = rows.reduce((a, r) => a + r.met + r.partial + r.missed, 0);
  assert.equal(total, 5);
  assert.equal(graded_, publicScore(graded).itemsGraded);
});

test('an item the catalogue no longer knows keeps its place rather than vanishing', () => {
  const rows = sectionBreakdown({ 'RETIRED-99': g('met') });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'unknown');
  assert.equal(rows[0].total, 1);
});

// ── standard and Mark ──────────────────────────────────────────────────────

test('the standard is met at the threshold, not above it', () => {
  assert.equal(meetsStandard('full', PASS_THRESHOLD, 0), true);
  assert.equal(meetsStandard('full', PASS_THRESHOLD - 1, 0), false);
  assert.equal(meetsStandard('full', 100, 1), false, 'one critical failure blocks it');
  assert.equal(meetsStandard('desk', 100, 0), false, 'a Desk Review never meets it');
  assert.equal(meetsStandard('full', null, 0), false, 'nothing graded cannot meet it');
});

test('only a Full Audit carries the Specula Mark', () => {
  assert.equal(marksAudit('full', true), true);
  assert.equal(marksAudit('spot', true), false, 'a passing Spot Audit carries no Mark');
  assert.equal(marksAudit('desk', true), false);
  assert.equal(marksAudit('full', false), false, 'and only when the standard is met');
});

// ── basis ──────────────────────────────────────────────────────────────────

test('the basis speaks public vocabulary, not the internal status', () => {
  const frozen = resolveScoringProfile(
    buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL, lockedAt: '2026-09-12T08:14:00.000Z' }),
    PROP, SNAPSHOT_STATUS.FROZEN,
  );
  assert.deepEqual(basisFor(frozen), { state: 'frozen', recordedOn: '2026-09-12T08:14:00.000Z' });

  const legacy = resolveScoringProfile(null, PROP, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.deepEqual(basisFor(legacy), { state: 'legacy', recordedOn: null });

  const broken = resolveScoringProfile({ propertyCategory: '5★' }, PROP, SNAPSHOT_STATUS.UNUSABLE);
  assert.deepEqual(basisFor(broken), { state: 'incomplete', recordedOn: null });

  assert.deepEqual(basisFor(null), { state: 'legacy', recordedOn: null });
});

test('a basis never claims frozen without a date to show', () => {
  const noDate = { frozen: true, lockedAt: null, status: 'frozen' };
  const b = basisFor(noDate);
  assert.equal(b.recordedOn, null);
  // And the payload built from it must not pass validation, because the
  // frozen disclosure line has a date in it.
  const payload = buildPublishedResult(baseInput({ scoringBasis: noDate }));
  assert.ok(validatePublishedResult(payload).some((e) => e.includes('recordedOn')));
});

// ── the whole payload ──────────────────────────────────────────────────────

test('a full payload carries everything the report renders', () => {
  const payload = buildPublishedResult(baseInput({
    criticalFailures: [{ itemId: 'RM-02', label: 'No hair, stains, or odors', note: 'Bathroom, room 402.' }],
  }));

  assert.equal(payload.formatVersion, PUBLISHED_RESULT_VERSION);
  assert.equal(payload.publishedAt, PUBLISHED_AT);
  assert.equal(payload.auditedOn, AUDITED_ON);
  assert.equal(payload.auditType, 'full');
  assert.deepEqual(payload.property, {
    name: 'Hotel Borealis', city: 'Reykjavik', country: 'Iceland', category: '5★',
  });
  assert.deepEqual(payload.score, { percent: 67, itemsMet: 2, itemsGraded: 3 });
  assert.equal(payload.standardMet, false, 'a critical failure blocks it');
  assert.equal(payload.sections.length, 1);
  assert.deepEqual(payload.criticalFailures, [
    { itemId: 'RM-02', label: 'No hair, stains, or odors', note: 'Bathroom, room 402.' },
  ]);
  assert.deepEqual(payload.basis, { state: 'frozen', recordedOn: '2026-09-12T08:14:00.000Z' });
  assert.equal(isValidPublishedResult(payload), true);
});

test('the payload is deterministic: same input, identical output', () => {
  const a = JSON.stringify(buildPublishedResult(baseInput()));
  const b = JSON.stringify(buildPublishedResult(baseInput()));
  assert.equal(a, b);
});

test('the payload holds no framework certification data', () => {
  const payload = buildPublishedResult(baseInput());
  const flat = JSON.stringify(payload);
  for (const leak of [
    'certif', 'foundation', 'distinction', 'coverage', 'weightClass', 'dimension',
    'findings', 'severity', 'frameworkVersion', 'checklistVersion', 'facilityProfile',
    'scopeSections', 'elite', 'exceptional',
  ]) {
    assert.equal(flat.toLowerCase().includes(leak.toLowerCase()), false, `${leak} must not reach the public payload`);
  }
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['auditType', 'auditedOn', 'basis', 'criticalFailures', 'formatVersion',
      'property', 'publishedAt', 'score', 'sections', 'standardMet', 'summary'].sort(),
  );
});

test('a critical failure with no label falls back to its item id, never to nothing', () => {
  const payload = buildPublishedResult(baseInput({
    criticalFailures: [{ itemId: 'RM-02', label: '   ', note: '' }],
  }));
  assert.deepEqual(payload.criticalFailures, [{ itemId: 'RM-02', label: 'RM-02', note: null }]);
});

test('blank property fields become null rather than empty strings', () => {
  const payload = buildPublishedResult(baseInput({
    prop: { name: 'Hotel Borealis', city: '  ', country: null, category: '' },
  }));
  assert.deepEqual(payload.property, { name: 'Hotel Borealis', city: null, country: null, category: null });
  assert.equal(isValidPublishedResult(payload), true, 'only name is required');
});

test('a Desk Review never meets the standard however well it scores', () => {
  const graded = {};
  for (let i = 1; i <= 20; i++) graded[`PRE-${String(i).padStart(2, '0')}`] = g('met');
  const payload = buildPublishedResult(baseInput({ auditType: 'desk', graded }));
  assert.equal(payload.score.percent, 100);
  assert.equal(payload.standardMet, false);
  assert.equal(marksAudit(payload.auditType, payload.standardMet), false);
});

test('a passing Spot Audit meets the standard and still carries no Mark', () => {
  const graded = {};
  for (let i = 1; i <= 20; i++) graded[`RM-${String(i).padStart(2, '0')}`] = g('met');
  const payload = buildPublishedResult(baseInput({ auditType: 'spot', graded }));
  assert.equal(payload.standardMet, true);
  assert.equal(marksAudit(payload.auditType, payload.standardMet), false);
});

test('a legacy audit produces a valid payload with no invented date', () => {
  const payload = buildPublishedResult(baseInput({
    scoringBasis: resolveScoringProfile(null, PROP, SNAPSHOT_STATUS.LEGACY_UNFROZEN),
  }));
  assert.deepEqual(payload.basis, { state: 'legacy', recordedOn: null });
  assert.equal(isValidPublishedResult(payload), true);
});

// ── validation ─────────────────────────────────────────────────────────────

test('validation accepts the payload the builder produces', () => {
  for (const type of ['full', 'spot', 'desk']) {
    assert.deepEqual(validatePublishedResult(buildPublishedResult(baseInput({ auditType: type }))), []);
  }
});

test('validation rejects everything a reader could not render', () => {
  const good = buildPublishedResult(baseInput());
  const cases = [
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
    ['a future version', { ...good, formatVersion: 2 }],
    ['no version', { ...good, formatVersion: undefined }],
    ['an unknown audit type', { ...good, auditType: 'mystery' }],
    ['no publishedAt', { ...good, publishedAt: null }],
    ['no standardMet', { ...good, standardMet: undefined }],
    ['standardMet as a string', { ...good, standardMet: 'true' }],
    ['no property', { ...good, property: undefined }],
    ['no property name', { ...good, property: { ...good.property, name: null } }],
    ['no score', { ...good, score: undefined }],
    ['a non-numeric score', { ...good, score: { ...good.score, percent: 'eighty' } }],
    ['sections not an array', { ...good, sections: {} }],
    ['a section with no label', { ...good, sections: [{ id: 'room', total: 1, met: 1, partial: 0, missed: 0, na: 0 }] }],
    ['a section with no counts', { ...good, sections: [{ id: 'room', label: 'Room Quality' }] }],
    ['criticalFailures not an array', { ...good, criticalFailures: null }],
    ['no basis', { ...good, basis: undefined }],
    ['an unknown basis state', { ...good, basis: { state: 'thawed', recordedOn: null } }],
    ['frozen with no date', { ...good, basis: { state: 'frozen', recordedOn: null } }],
  ];
  for (const [label, payload] of cases) {
    assert.ok(
      validatePublishedResult(payload).length > 0,
      `${label} must be rejected`,
    );
    assert.equal(isValidPublishedResult(payload), false, `${label} must be rejected`);
  }
});

test('validation reports every problem, not just the first', () => {
  const errors = validatePublishedResult({ formatVersion: 9, auditType: 'mystery' });
  assert.ok(errors.length >= 4, `expected several errors, got ${errors.length}`);
  assert.ok(errors.some((e) => e.includes('formatVersion')));
  assert.ok(errors.some((e) => e.includes('auditType')));
});

test('a payload with zero graded items is still valid and still renderable', () => {
  const payload = buildPublishedResult(baseInput({ graded: {} }));
  assert.equal(payload.score.percent, null);
  assert.deepEqual(payload.sections, []);
  assert.equal(payload.standardMet, false);
  assert.equal(isValidPublishedResult(payload), true);
});
