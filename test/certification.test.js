import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { applicableItems } from '../src/framework/catalog.js';
import { SEVERITY, AUDIT_TYPE } from '../src/framework/weights.js';
import { FULL_5_STAR, FULL_4_STAR, FULL_ULTRA, gradeAll, setStatus, itemsWhere } from './helpers.js';

const run = (graded, profile, context) => certify(score(graded, profile), context);
const FULL = { auditType: AUDIT_TYPE.FULL };
const SPOT = { auditType: AUDIT_TYPE.SPOT };
const DESK = { auditType: AUDIT_TYPE.DESK };

/** Grade only the first `fraction` of applicable weight, all Met. */
function gradeFraction(profile, fraction) {
  const items = applicableItems(profile);
  const total = items.reduce((a, i) => a + i.weight, 0);
  const graded = {};
  let acc = 0;
  for (const i of items) {
    if (acc / total >= fraction) break;
    graded[i.id] = { day: { status: 'met' } };
    acc += i.weight;
  }
  return graded;
}

// ── Levels ─────────────────────────────────────────────────────────────────

test('a perfect Full Audit reaches Elite at 5★ and Ultra', () => {
  for (const profile of [FULL_5_STAR, FULL_ULTRA]) {
    const r = run(gradeAll(profile, 'met'), profile, FULL);
    assert.equal(r.level, 'elite', `${profile.category} should reach Elite`);
    assert.equal(r.eligible, true);
    assert.deepEqual(r.blockers, []);
    assert.equal(r.measured.overall, 100);
    assert.equal(r.measured.foundation, 100);
    assert.equal(r.measured.coverage, 100);
  }
});

test('each level is awarded at its own thresholds', () => {
  const nonFoundation = itemsWhere(FULL_5_STAR, (m) => m.weightClass !== 'foundation');
  const levels = new Set();
  for (let n = 0; n <= nonFoundation.length; n += 3) {
    const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), nonFoundation.slice(0, n), 'partial');
    const s = score(graded, FULL_5_STAR);
    const r = certify(s, FULL);
    assert.equal(s.byClass.foundation.score, 100, 'Foundation stays perfect');
    assert.equal(s.coverage, 100, 'everything is graded, so coverage never binds here');
    assert.equal(s.findingCounts.critical, 0);
    levels.add(r.level);
    if (r.level === 'elite') assert.ok(s.overall >= 95);
    if (r.level === 'exceptional') assert.ok(s.overall >= 90 && s.overall < 95);
    if (r.level === 'certified') assert.ok(s.overall >= 85 && s.overall < 90);
    if (r.level === 'none') assert.ok(s.overall < 85);
  }
  assert.deepEqual([...levels].sort(), ['certified', 'elite', 'exceptional', 'none']);
});

// ── Coverage is a certification requirement ────────────────────────────────

test('a perfect score with half the audit assessed does NOT certify', () => {
  const graded = gradeFraction(FULL_5_STAR, 0.5);
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);

  assert.equal(s.overall, 100, 'everything assessed was met');
  assert.equal(s.byClass.foundation.score, 100);
  assert.ok(s.coverage < 60 && s.coverage > 40, `coverage ${s.coverage} should be near half`);
  assert.equal(r.level, 'none', 'coverage alone must block certification');
  assert.equal(r.eligible, false);
  assert.deepEqual(r.blockers, [], 'this is a requirement failure, not a finding blocker');
  assert.ok(
    r.reasons.some((x) => /Coverage \d+(\.\d+)?% is below the 80% required/.test(x)),
    r.reasons.join(' | '),
  );
});

test('coverage gates each level at its own floor', () => {
  // Everything graded is Met, so overall and Foundation are always 100 and
  // coverage is the only variable.
  const cases = [
    [0.75, 'none'],
    [0.85, 'certified'],
    [0.92, 'exceptional'],
    [1.0, 'elite'],
  ];
  for (const [fraction, expected] of cases) {
    const s = score(gradeFraction(FULL_5_STAR, fraction), FULL_5_STAR);
    const r = certify(s, FULL);
    assert.equal(s.overall, 100);
    assert.equal(r.level, expected, `coverage ${s.coverage}% should give ${expected}, got ${r.level}`);
  }
});

test('coverage never reduces the score itself', () => {
  const partialCoverage = score(gradeFraction(FULL_5_STAR, 0.5), FULL_5_STAR);
  const fullCoverage = score(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR);
  assert.equal(partialCoverage.overall, fullCoverage.overall, 'the score measures quality, not completeness');
  assert.ok(partialCoverage.coverage < fullCoverage.coverage);
});

// ── Audit type gates ───────────────────────────────────────────────────────

test('a Desk Review cannot certify, however well it scores', () => {
  for (const profile of [FULL_4_STAR, FULL_5_STAR, FULL_ULTRA]) {
    const r = run(gradeAll(profile, 'met'), profile, DESK);
    assert.equal(r.level, 'none');
    assert.equal(r.eligible, false);
    assert.equal(r.ceiling, 'none', 'no level is reachable by a Desk Review');
    assert.equal(r.measured.overall, 100);
    assert.ok(
      r.reasons.some((x) => x === 'A Desk Review cannot receive Specula Certified'),
      r.reasons.join(' | '),
    );
  }
});

test('a Spot Audit can reach Certified but never Exceptional or Elite', () => {
  const r = run(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR, SPOT);
  assert.equal(r.level, 'certified');
  assert.equal(r.eligible, true);
  assert.equal(r.ceiling, 'certified');
  assert.equal(r.measured.overall, 100, 'a perfect score still stops at Certified');
  assert.ok(
    r.reasons.some((x) => x === 'Not Specula Exceptional: A Spot Audit cannot receive Specula Exceptional'),
    r.reasons.join(' | '),
  );
  const failedLevels = r.evaluations.filter((e) => !e.pass).map((e) => e.level);
  assert.deepEqual(failedLevels, ['exceptional', 'elite']);
  for (const e of r.evaluations.filter((x) => !x.pass)) {
    assert.deepEqual(e.failed, ['auditType'], 'only the audit type stops it');
  }
});

test('a Full Audit can reach every level', () => {
  const nonFoundation = itemsWhere(FULL_5_STAR, (m) => m.weightClass !== 'foundation');
  const reached = new Set();
  for (let n = 0; n <= nonFoundation.length; n += 3) {
    const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), nonFoundation.slice(0, n), 'partial');
    reached.add(certify(score(graded, FULL_5_STAR), FULL).level);
  }
  for (const level of ['certified', 'exceptional', 'elite']) {
    assert.ok(reached.has(level), `a Full Audit must be able to reach ${level}`);
  }
});

// ── Property tier restriction on Elite ─────────────────────────────────────

test('4★ cannot reach Elite, and stops at Exceptional', () => {
  const r = run(gradeAll(FULL_4_STAR, 'met'), FULL_4_STAR, FULL);
  assert.equal(r.level, 'exceptional');
  assert.equal(r.ceiling, 'exceptional');
  assert.equal(r.measured.overall, 100, 'a flawless 4★ audit still cannot be Elite');
  assert.ok(
    r.reasons.some((x) => /Specula Elite is available to 5★ and Ultra properties only, this one is 4★/.test(x)),
    r.reasons.join(' | '),
  );
  const elite = r.evaluations.find((e) => e.level === 'elite');
  assert.deepEqual(elite.failed, ['category']);
});

test('5★ can reach Elite', () => {
  const r = run(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR, FULL);
  assert.equal(r.level, 'elite');
  assert.equal(r.category, '5★');
});

test('Ultra can reach Elite', () => {
  const r = run(gradeAll(FULL_ULTRA, 'met'), FULL_ULTRA, FULL);
  assert.equal(r.level, 'elite');
  assert.equal(r.category, 'Ultra');
});

test('an uncategorised property cannot reach Elite', () => {
  const profile = { hasRestaurant: true, hasPool: true, hasSpa: true };
  const r = run(gradeAll(profile, 'met'), profile, FULL);
  assert.notEqual(r.level, 'elite');
  assert.equal(r.ceiling, 'exceptional');
});

// ── Foundation floor ───────────────────────────────────────────────────────

test('the Foundation exploit is blocked: high overall, failed Foundation floor', () => {
  // Miss four Foundation items whose default severity is only Major, so no
  // Critical finding is raised and the floors are tested in isolation.
  const majorFoundation = itemsWhere(
    FULL_5_STAR,
    (m) => m.weightClass === 'foundation' && m.defaultSeverity === SEVERITY.MAJOR,
  ).slice(0, 4);

  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), majorFoundation, 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);

  assert.ok(s.overall >= 95, `overall ${s.overall} would otherwise qualify for Elite`);
  assert.equal(s.coverage, 100, 'coverage is perfect, so only the Foundation floor can block');
  assert.ok(s.byClass.foundation.score < 90, `Foundation ${s.byClass.foundation.score} is below the Certified floor`);
  assert.equal(s.findingCounts.critical, 0, 'no Critical finding, so only the floor can block this');
  assert.equal(r.level, 'none');
  assert.ok(r.reasons.some((x) => /Foundation score .* below the 90% required/.test(x)), r.reasons.join(' | '));
});

test('failing a large share of Foundation while perfect elsewhere never certifies', () => {
  const foundation = itemsWhere(FULL_5_STAR, (m) => m.weightClass === 'foundation');
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), foundation.slice(0, Math.ceil(foundation.length * 0.3)), 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);
  assert.ok(s.overall > 85, `overall ${s.overall} still looks respectable`);
  assert.equal(r.level, 'none');
  assert.ok(r.blockers.length > 0 || r.reasons.length > 0);
});

// ── Findings ───────────────────────────────────────────────────────────────

test('a single Critical finding blocks certification at every level', () => {
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), ['BTH-01'], 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);

  assert.ok(s.overall > 98, `overall ${s.overall} is otherwise excellent`);
  assert.equal(s.findingCounts.critical, 1);
  assert.equal(r.level, 'none');
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.some((b) => b.startsWith('Critical finding: BTH-01')), r.blockers.join(' | '));
  assert.ok(r.reasons.some((x) => /1 Critical finding recorded/.test(x)));
});

test('a Partial on a Critical item stays Critical and blocks', () => {
  // Approved Phase 4B. Under the old blanket step-down this reached Elite.
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), ['BTH-01'], 'partial');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);
  assert.equal(s.findingCounts.critical, 1);
  assert.equal(s.findingCounts.major, 0);
  assert.equal(r.level, 'none');
  assert.ok(r.blockers.some((b) => b.includes('BTH-01')), r.blockers.join(' | '));
});

test('a Partial on a Major item still steps down to Minor', () => {
  // Only the Critical case changed. ARR-01 is Foundation, default Major.
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), ['ARR-01'], 'partial');
  const s = score(graded, FULL_5_STAR);
  assert.equal(s.findingCounts.major, 0);
  assert.equal(s.findingCounts.minor, 1);
  assert.equal(certify(s, FULL).level, 'elite');
});

test('v1 has no Major cap: Major findings are counted, not blocking', () => {
  const majorItems = itemsWhere(FULL_5_STAR, (m) => m.defaultSeverity === SEVERITY.MAJOR && m.weightClass !== 'foundation');
  const graded = setStatus(gradeAll(FULL_5_STAR, 'met'), majorItems.slice(0, 8), 'missed');
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);
  assert.ok(s.findingCounts.major >= 8, `expected at least 8 Major findings, got ${s.findingCounts.major}`);
  assert.equal(s.findingCounts.critical, 0);
  assert.equal(r.measured.majorFindings, s.findingCounts.major, 'Major findings are reported on the result');
  assert.deepEqual(r.blockers, [], 'Major findings never appear as blockers in v1');
  assert.ok(r.eligible, 'eight Major findings must not by themselves prevent certification');
});

test('a Zero Tolerance trigger blocks certification', () => {
  const graded = {
    ...gradeAll(FULL_5_STAR, 'met'),
    'PL-03': { day: { status: 'missed', escalation: { severity: SEVERITY.ZERO_TOLERANCE, note: 'Chlorine far outside range', evidence: 'test-strip.jpg' } } },
  };
  const s = score(graded, FULL_5_STAR);
  const r = certify(s, FULL);
  assert.equal(s.zeroToleranceTriggered, true);
  assert.equal(r.level, 'none');
  assert.ok(r.blockers.some((b) => b.startsWith('Zero Tolerance: PL-03')), r.blockers.join(' | '));
});

// ── Result shape ───────────────────────────────────────────────────────────

test('the result explains itself rather than returning a bare percentage', () => {
  const r = run(gradeAll(FULL_5_STAR, 'partial'), FULL_5_STAR, FULL);
  assert.equal(r.level, 'none');
  assert.equal(typeof r.eligible, 'boolean');
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
  assert.ok(Array.isArray(r.blockers));
  assert.ok(r.measured.overall !== undefined);
  assert.ok(r.measured.foundation !== undefined);
  assert.ok(r.measured.coverage !== undefined);
  assert.ok(Array.isArray(r.evaluations) && r.evaluations.length === 3);
  assert.equal(r.auditType, AUDIT_TYPE.FULL);
});

test('audit type defaults to Full, matching the audits.tier column default', () => {
  const s = score(gradeAll(FULL_5_STAR, 'met'), FULL_5_STAR);
  assert.equal(certify(s).auditType, AUDIT_TYPE.FULL);
  assert.equal(certify(s).level, 'elite');
});

test('an ungraded audit produces no certification and says why', () => {
  const r = certify(score({}, FULL_5_STAR), FULL);
  assert.equal(r.level, 'none');
  assert.equal(r.eligible, false);
  assert.match(r.reasons[0], /No items have been assessed yet/);
  assert.equal(r.outcome, 'NO_ITEMS_GRADED');
});
