// Regression against the one published audit in Supabase.
//
// The fixture is a READ-ONLY capture. Nothing here connects to Supabase and
// nothing writes anywhere. Its purpose is to prove that the derived-finding
// model does not inherit the invalid critical flags the current system stored.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { worstStatus } from '../src/framework/findings.js';
import { applicableItems } from '../src/framework/catalog.js';
import { SEVERITY } from '../src/framework/weights.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(here, '../src/framework/__fixtures__/audit-AHP-2026-8B10.json'), 'utf8'),
);

/** Shape the capture into the graded structure the engine expects. */
function toGraded(f) {
  const graded = {};
  for (const [itemId, byShift] of Object.entries(f.statuses)) {
    graded[itemId] = {};
    for (const [shiftId, status] of Object.entries(byShift)) {
      graded[itemId][shiftId] = { status };
    }
  }
  return graded;
}

const graded = toGraded(fixture);
const profile = fixture.property;
const result = score(graded, profile);
const cert = certify(result, { auditType: fixture.tier });

test('the capture is faithful to what the console recorded', () => {
  assert.equal(Object.keys(fixture.statuses).length, 81, '81 distinct items carry a status row');
  assert.equal(fixture.statuses['RST-05'].day, null);
  assert.equal(fixture.statuses['RST-06'].day, null);
  assert.equal(fixture.legacyCriticalFlags['RST-05'].day, true);
  assert.equal(fixture.legacyCriticalFlags['RST-06'].day, true);
});

test('the old flat score is reproduced from the same data', () => {
  // met / (met + partial + missed), worst status across shifts, unweighted.
  let met = 0, graded_ = 0;
  for (const byShift of Object.values(graded)) {
    const s = worstStatus(byShift);
    if (!s || s === 'na') continue;
    graded_ += 1;
    if (s === 'met') met += 1;
  }
  assert.equal(graded_, 81);
  assert.equal(Math.round((met / graded_) * 100), fixture.legacyScorePct, 'legacy score is 58%');
});

test('ungraded status creates no finding, so the invalid critical flags do not carry over', () => {
  // RST-05 day is null with critical=true, RST-06 day is null with critical=true.
  // Under the old model both blocked the seal. Under this model:
  //   RST-05 is Missed on the night shift, so it raises its own Major finding
  //   RST-06 is Met on the night shift, so it raises nothing at all
  const byItem = new Map(result.findings.map((f) => [f.itemId, f]));

  const rst05 = byItem.get('RST-05');
  assert.ok(rst05, 'RST-05 raises a finding, but from its Missed night shift');
  assert.equal(rst05.status, 'missed');
  assert.equal(rst05.severity, SEVERITY.MAJOR, 'from its default severity, not from the legacy flag');
  assert.equal(rst05.escalated, false);
  assert.equal(rst05.source, 'derived');

  assert.equal(byItem.get('RST-06'), undefined, 'RST-06 is Met, so it raises no finding at all');

  // Neither legacy flag survives as a Critical finding.
  assert.equal(result.findingCounts.critical, 0);
  assert.equal(result.findingCounts.zero_tolerance, 0);
  for (const legacy of fixture.legacyCriticalFailures) {
    const finding = byItem.get(legacy.itemId);
    assert.notEqual(
      finding && finding.severity,
      SEVERITY.CRITICAL,
      `${legacy.itemId} must not become a Critical finding on the strength of a flag alone`,
    );
  }
});

test('certification is decided by actual statuses, not by legacy flags', () => {
  assert.equal(cert.level, 'none');
  assert.equal(cert.eligible, false);
  assert.deepEqual(cert.blockers, [], 'no Critical or Zero Tolerance blockers exist in this audit');
  // It fails on the numbers, which is the point: the old system blocked it on
  // two flags attached to items that were never assessed.
  assert.ok(cert.reasons.some((r) => /Overall score 74\.1% is below the 85% required/.test(r)), cert.reasons.join(' | '));
  assert.ok(cert.reasons.some((r) => /Foundation score 87\.5% is below the 90% required/.test(r)), cert.reasons.join(' | '));
  assert.ok(cert.reasons.some((r) => /Coverage 71\.2% is below the 80% required/.test(r)), cert.reasons.join(' | '));
});

test('the audit type and tier gates are applied to the real audit', () => {
  assert.equal(cert.auditType, 'full', 'the fixture records tier "full"');
  assert.equal(cert.category, '5★');
  assert.equal(cert.ceiling, 'elite', 'a Full Audit of a 5★ property could have reached Elite');
  assert.equal(cert.measured.majorFindings, 4, 'Major findings are reported, and do not block in v1');
});

test('weighted scores, coverage and subscores are stable', () => {
  assert.equal(result.overall, 74.1);
  assert.equal(result.coverage, 71.2);
  assert.equal(result.naShare, 0);
  assert.equal(result.byClass.foundation.score, 87.5);
  assert.equal(result.byClass.standard.score, 69.1);
  assert.equal(result.byClass.distinction.score, 65);
  assert.equal(result.byDimension.condition.score, 85.1);
  assert.equal(result.byDimension.service.score, 77.3);
  assert.equal(result.byDimension.product.score, 67.3);
  assert.equal(result.byDimension.experience.score, 56.7);
  assert.deepEqual(result.findingCounts, { minor: 30, major: 4, critical: 0, zero_tolerance: 0 });
});

test('coverage reflects that a quarter of the property was never assessed', () => {
  const applicable = applicableItems(profile);
  assert.equal(result.counts.applicable, applicable.length);
  assert.equal(result.counts.graded, 81);
  assert.equal(result.counts.ungraded, applicable.length - 81);
  assert.ok(result.coverage < 75, `coverage ${result.coverage} must show the gap`);
  assert.ok(
    result.overallOfApplicable < result.overall,
    'counting ungraded items as zero must score lower than the quality score',
  );
});

test('the five new items are unassessed in this pre-v1.0 audit', () => {
  for (const id of ['SAF-01', 'SAF-02', 'SAF-03', 'REC-11']) {
    assert.equal(graded[id], undefined, `${id} did not exist when this audit ran`);
  }
  // SP-13 sits behind hasSpa, and this property has no spa, so it is not even
  // applicable and never enters any denominator.
  assert.equal(applicableItems(profile).some((i) => i.id === 'SP-13'), false);
});
