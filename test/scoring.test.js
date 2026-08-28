import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { applicableItems } from '../src/framework/catalog.js';
import { SEVERITY } from '../src/framework/weights.js';
import { FULL_5_STAR, ROOMS_ONLY_5, gradeAll, setStatus, itemsWhere } from './helpers.js';

test('a perfect audit scores 100 on every measure', () => {
  const r = score(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR);
  assert.equal(r.overall, 100);
  assert.equal(r.overallOfApplicable, 100);
  assert.equal(r.coverage, 100);
  assert.equal(r.naShare, 0);
  assert.equal(r.byClass.foundation.score, 100);
  assert.equal(r.byClass.standard.score, 100);
  assert.equal(r.byClass.distinction.score, 100);
  for (const d of Object.values(r.byDimension)) assert.equal(d.score, 100);
  assert.equal(r.findings.length, 0);
  assert.equal(r.zeroToleranceTriggered, false);
});

test('Partial is worth exactly half the item weight', () => {
  const r = score(gradeAll(FULL_5_STAR, 'partial'), FULL_5_STAR);
  assert.equal(r.overall, 50);
  assert.equal(r.coverage, 100);

  // And on a single item, in isolation.
  const one = score({ 'RM-01': { day: { status: 'partial' } } }, FULL_5_STAR);
  assert.equal(one.overall, 50);
  assert.equal(one.weights.graded, 3, 'RM-01 is Foundation, weight 3');
});

test('Missed is worth zero and still occupies the denominator', () => {
  const r = score(gradeAll(FULL_5_STAR, 'missed'), FULL_5_STAR);
  assert.equal(r.overall, 0);
  assert.equal(r.coverage, 100);
  assert.equal(r.weights.graded, r.weights.inScope);
});

test('N/A leaves both the numerator and the denominator', () => {
  const met = { 'RM-01': { day: { status: 'met' } } };          // weight 3
  const withNa = { ...met, 'RM-06': { day: { status: 'na' } } }; // weight 2

  const a = score(met, FULL_5_STAR);
  const b = score(withNa, FULL_5_STAR);

  assert.equal(a.overall, 100);
  assert.equal(b.overall, 100, 'the N/A item must not drag the score down');
  assert.equal(b.weights.graded, 3, 'N/A weight is not graded weight');
  assert.equal(b.weights.na, 2);
  assert.equal(b.weights.inScope, a.weights.inScope - 2, 'N/A leaves the in-scope denominator');
  // Same graded weight over a smaller in-scope denominator, so coverage rises.
  // Compared unrounded, because both round to the same single decimal here.
  assert.ok(
    b.weights.graded / b.weights.inScope > a.weights.graded / a.weights.inScope,
    'removing an item from scope raises coverage',
  );
  assert.equal(b.findings.length, 0, 'N/A raises no finding');
});

test('ungraded items are never treated as Met, and coverage shows it', () => {
  const r = score({ 'RM-01': { day: { status: 'met' } } }, FULL_5_STAR);
  assert.equal(r.overall, 100, 'quality of what was assessed');
  assert.ok(r.coverage < 2, `coverage must reflect one graded item, got ${r.coverage}`);
  assert.ok(
    r.overallOfApplicable < 2,
    `counting ungraded as zero must not resemble a perfect audit, got ${r.overallOfApplicable}`,
  );
  assert.equal(r.counts.graded, 1);
  assert.equal(r.counts.ungraded, r.counts.applicable - 1);
  assert.equal(r.findings.length, 0, 'ungraded items raise no findings');
});

test('coverage never inflates the score', () => {
  // Half the items graded, all met. Score stays 100, coverage falls to ~50.
  const items = applicableItems(FULL_5_STAR);
  const half = items.slice(0, Math.floor(items.length / 2));
  const graded = {};
  for (const i of half) graded[i.id] = { day: { status: 'met' } };
  const r = score(graded, FULL_5_STAR);
  assert.equal(r.overall, 100);
  assert.ok(r.coverage > 35 && r.coverage < 65, `coverage ${r.coverage} should be near half`);
  assert.ok(r.overallOfApplicable < 65);
});

test('facility gating removes whole sections from every denominator', () => {
  const full = score(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR);
  const rooms = score(gradeAll(ROOMS_ONLY_5, 'met'), ROOMS_ONLY_5);
  assert.ok(rooms.weights.applicable < full.weights.applicable);
  assert.equal(rooms.overall, 100, 'a property with no spa is not punished for having none');
  assert.equal(rooms.coverage, 100);
  assert.equal(rooms.bySection.spa, undefined);
  assert.equal(rooms.bySection.pool, undefined);
});

test('subscores use the same engine and agree with the whole', () => {
  const foundationIds = itemsWhere(FULL_5_STAR, (m) => m.weightClass === 'foundation');
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), foundationIds, 'missed');
  const r = score(graded, FULL_5_STAR);
  assert.equal(r.byClass.foundation.score, 0);
  assert.equal(r.byClass.standard.score, 100);
  assert.equal(r.byClass.distinction.score, 100);
  // Foundation contributes nothing, so overall is the Standard plus Distinction
  // weight over the whole applicable pool for this profile.
  const kept = r.byClass.standard.applicableWeight + r.byClass.distinction.applicableWeight;
  const expected = Math.round((kept / r.weights.graded) * 1000) / 10;
  assert.equal(r.overall, expected, 'overall is the weighted mean of the parts');
  assert.equal(r.weights.graded, r.weights.applicable, 'every applicable item was graded');
});

test('shift disagreement resolves to the worst status', () => {
  const r = score({ 'RM-01': { day: { status: 'met' }, night: { status: 'missed' } } }, FULL_5_STAR);
  assert.equal(r.overall, 0);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'missed');
});

test('an invalid escalation is reported, never silently honoured', () => {
  // ARR-01 is not Zero Tolerance eligible.
  const graded = {
    'ARR-01': { day: { status: 'missed', escalation: { severity: SEVERITY.ZERO_TOLERANCE, note: 'n', evidence: 'e.jpg' } } },
  };
  const r = score(graded, FULL_5_STAR);
  assert.equal(r.escalationErrors.length, 1);
  assert.match(r.escalationErrors[0].message, /not Zero Tolerance eligible/);
  assert.equal(r.zeroToleranceTriggered, false, 'the invalid escalation must not trigger');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, SEVERITY.MAJOR, 'the derived finding still stands');
});

test('a valid Zero Tolerance escalation is surfaced on the result', () => {
  const graded = {
    'BTH-01': { day: { status: 'missed', escalation: { severity: SEVERITY.ZERO_TOLERANCE, note: 'Extensive mould', evidence: 'bath.jpg' } } },
  };
  const r = score(graded, FULL_5_STAR);
  assert.equal(r.zeroToleranceTriggered, true);
  assert.deepEqual(r.zeroToleranceItems, ['BTH-01']);
  assert.equal(r.findingCounts.zero_tolerance, 1);
  assert.equal(r.escalationErrors.length, 0);
});

test('an audit with nothing graded produces no score rather than a zero', () => {
  const r = score({}, FULL_5_STAR);
  assert.equal(r.overall, null);
  assert.equal(r.coverage, 0);
  assert.equal(r.findings.length, 0);
});
