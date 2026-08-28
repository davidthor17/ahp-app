import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { SEVERITY } from '../src/framework/weights.js';
import { FULL_5_STAR, FULL_4_STAR, FULL_ULTRA, gradeAll, setStatus, itemsWhere } from './helpers.js';

const run = (graded, profile, context) => certify(score(graded, profile), context);

test('a perfect audit reaches Elite', () => {
  for (const profile of [FULL_4_STAR, FULL_5_STAR, FULL_ULTRA]) {
    const r = run(gradeAll(profile, 'met'), profile);
    assert.equal(r.level, 'elite', `${profile.category} should reach Elite`);
    assert.equal(r.eligible, true);
    assert.deepEqual(r.blockers, []);
    assert.equal(r.measured.overall, 100);
    assert.equal(r.measured.foundation, 100);
  }
});

test('the Foundation exploit is blocked: high overall, failed Foundation floor', () => {
  // Miss four Foundation items whose default severity is only Major, so no
  // Critical finding is raised and the score floors are tested in isolation.
  const majorFoundation = itemsWhere(
    FULL_5_STAR,
    (m) => m.weightClass === 'foundation' && m.defaultSeverity === SEVERITY.MAJOR,
  ).slice(0, 4);

  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), majorFoundation, 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s);

  assert.ok(s.overall >= 95, `overall ${s.overall} would otherwise qualify for Elite`);
  assert.ok(s.byClass.foundation.score < 90, `Foundation ${s.byClass.foundation.score} is below the Certified floor`);
  assert.equal(s.findingCounts.critical, 0, 'no Critical finding, so only the floor can block this');
  assert.equal(r.level, 'none');
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.some((x) => /Foundation score .* below the 90% required/.test(x)), r.reasons.join(' | '));
});

test('failing a large share of Foundation while perfect elsewhere never certifies', () => {
  const foundation = itemsWhere(FULL_5_STAR, (m) => m.weightClass === 'foundation');
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), foundation.slice(0, Math.ceil(foundation.length * 0.3)), 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s);
  assert.ok(s.overall > 85, `overall ${s.overall} still looks respectable`);
  assert.equal(r.level, 'none');
  assert.ok(r.blockers.length > 0 || r.reasons.length > 0);
});

test('a single Critical finding blocks certification at every level', () => {
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), ['BTH-01'], 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s);

  assert.ok(s.overall > 98, `overall ${s.overall} is otherwise excellent`);
  assert.equal(s.findingCounts.critical, 1);
  assert.equal(r.level, 'none');
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.some((b) => b.startsWith('Critical finding: BTH-01')), r.blockers.join(' | '));
  assert.ok(r.reasons.some((x) => /1 Critical finding recorded/.test(x)));
});

test('a Partial on a Critical item becomes Major and does not block', () => {
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), ['BTH-01'], 'partial');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s);
  assert.equal(s.findingCounts.critical, 0);
  assert.equal(s.findingCounts.major, 1);
  assert.equal(r.blockers.length, 0);
  assert.equal(r.level, 'elite', 'a single partial on one item should not cost certification');
});

test('a Zero Tolerance trigger blocks certification', () => {
  const graded = {
    ...gradeAll(FULL_5_STAR, 'met'),
    'PL-03': { day: { status: 'missed', escalation: { severity: SEVERITY.ZERO_TOLERANCE, note: 'Chlorine far outside range', evidence: 'test-strip.jpg' } } },
  };
  const s = score(graded, FULL_5_STAR);
  const r = certify(s);
  assert.equal(s.zeroToleranceTriggered, true);
  assert.equal(r.level, 'none');
  assert.ok(r.blockers.some((b) => b.startsWith('Zero Tolerance: PL-03')), r.blockers.join(' | '));
});

test('each level is awarded at its own thresholds', () => {
  // Foundation held at 100 throughout; Standard and Distinction dialled down
  // until the overall score crosses each threshold.
  const nonFoundation = itemsWhere(FULL_5_STAR, (m) => m.weightClass !== 'foundation');
  const levels = new Set();
  for (let n = 0; n <= nonFoundation.length; n += 3) {
    const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), nonFoundation.slice(0, n), 'partial');
    const s = score(graded, FULL_5_STAR);
    const r = certify(s);
    assert.equal(s.byClass.foundation.score, 100, 'Foundation stays perfect');
    assert.equal(s.findingCounts.critical, 0, 'partials on non-Foundation items raise no Critical');
    levels.add(r.level);
    if (r.level === 'elite') assert.ok(s.overall >= 95);
    if (r.level === 'exceptional') assert.ok(s.overall >= 90 && s.overall < 95);
    if (r.level === 'certified') assert.ok(s.overall >= 85 && s.overall < 90);
    if (r.level === 'none') assert.ok(s.overall < 85);
  }
  assert.deepEqual([...levels].sort(), ['certified', 'elite', 'exceptional', 'none']);
});

test('the result explains itself rather than returning a bare percentage', () => {
  const r = run(gradeAll(FULL_5_STAR, 'partial'), FULL_5_STAR);
  assert.equal(r.level, 'none');
  assert.equal(typeof r.eligible, 'boolean');
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
  assert.ok(Array.isArray(r.blockers));
  assert.ok(r.measured.overall !== undefined && r.measured.foundation !== undefined);
  assert.ok(Array.isArray(r.evaluations) && r.evaluations.length === 3);
});

test('an awarded level also says what stopped the next one', () => {
  const nonFoundation = itemsWhere(FULL_5_STAR, (m) => m.weightClass !== 'foundation');
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), nonFoundation.slice(0, 40), 'partial');
  const r = certify(score(graded, FULL_5_STAR));
  if (r.eligible && r.level !== 'elite') {
    assert.ok(r.reasons.some((x) => x.startsWith('Not Specula ')), r.reasons.join(' | '));
  }
});

test('certification carries the audit type through without gating on it', () => {
  const s = score(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR);
  assert.equal(certify(s, { auditType: 'full' }).auditType, 'full');
  assert.equal(certify(s, { auditType: 'spot' }).level, 'elite', 'audit type is carried, not enforced, in Phase 1');
});

test('an ungraded audit produces no certification and says why', () => {
  const r = certify(score({}, FULL_5_STAR));
  assert.equal(r.level, 'none');
  assert.equal(r.eligible, false);
  assert.match(r.reasons[0], /No graded items/);
});
