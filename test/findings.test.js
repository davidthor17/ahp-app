import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveFinding,
  derivedSeverity,
  stepDown,
  worstStatus,
  zeroToleranceProblems,
  InvalidEscalationError,
} from '../src/framework/findings.js';
import { catalogIndex } from '../src/framework/catalog.js';
import { SEVERITY, STATUS } from '../src/framework/weights.js';

const index = catalogIndex();
const critical = index.get('BTH-01');   // Foundation, Critical, ZT eligible
const major = index.get('ARR-01');      // Foundation, Major, not ZT eligible
const minor = index.get('ARR-03');      // Standard, Minor
const ztMajor = index.get('FBS-09');    // Foundation, Major, ZT eligible

test('the severity ladder steps down and floors at Minor', () => {
  assert.equal(stepDown(SEVERITY.CRITICAL), SEVERITY.MAJOR);
  assert.equal(stepDown(SEVERITY.MAJOR), SEVERITY.MINOR);
  assert.equal(stepDown(SEVERITY.MINOR), SEVERITY.MINOR);
});

test('Missed raises a finding at the item default severity', () => {
  assert.equal(deriveFinding(critical, STATUS.MISSED).severity, SEVERITY.CRITICAL);
  assert.equal(deriveFinding(major, STATUS.MISSED).severity, SEVERITY.MAJOR);
  assert.equal(deriveFinding(minor, STATUS.MISSED).severity, SEVERITY.MINOR);
});

test('Partial on a Critical item stays Critical', () => {
  // Approved Phase 4B: a hazard partly present is still present.
  const finding = deriveFinding(critical, STATUS.PARTIAL);
  assert.equal(finding.severity, SEVERITY.CRITICAL);
  assert.equal(finding.defaultSeverity, SEVERITY.CRITICAL);
  assert.equal(finding.escalated, false);
  assert.equal(finding.source, 'derived');
});

test('Met, N/A and ungraded raise no finding at all', () => {
  for (const status of [STATUS.MET, STATUS.NA, null, undefined]) {
    assert.equal(deriveFinding(critical, status), null, `status ${status} must raise no finding`);
    assert.equal(derivedSeverity(status, SEVERITY.CRITICAL), null);
  }
});

test('a finding can never exist without a failing status', () => {
  // This is the structural fix: an escalation on a non-failing status throws
  // rather than creating the free-floating finding the old boolean allowed.
  for (const status of [STATUS.MET, STATUS.NA, null]) {
    assert.throws(
      () => deriveFinding(critical, status, { severity: SEVERITY.CRITICAL, note: 'x', evidence: 'p.jpg' }),
      InvalidEscalationError,
    );
  }
});

test('worstStatus takes the worst grade across shifts and ignores nulls', () => {
  assert.equal(worstStatus({ day: { status: 'met' }, night: { status: 'missed' } }), 'missed');
  assert.equal(worstStatus({ day: { status: 'partial' }, night: { status: 'met' } }), 'partial');
  assert.equal(worstStatus({ day: { status: null }, night: { status: 'met' } }), 'met');
  assert.equal(worstStatus({ day: { status: null } }), null);
  assert.equal(worstStatus(null), null);
});

test('Zero Tolerance requires all four conditions', () => {
  const good = { severity: SEVERITY.ZERO_TOLERANCE, note: 'Exit blocked by stored furniture', evidence: 'exit.jpg' };

  const finding = deriveFinding(ztMajor, STATUS.MISSED, good);
  assert.equal(finding.severity, SEVERITY.ZERO_TOLERANCE);
  assert.equal(finding.escalated, true);
  assert.equal(finding.source, 'auditor');

  // not eligible
  assert.throws(() => deriveFinding(major, STATUS.MISSED, good), /not Zero Tolerance eligible/);
  // wrong status
  assert.throws(() => deriveFinding(ztMajor, STATUS.PARTIAL, good), /status must be "missed"/);
  // no evidence
  assert.throws(
    () => deriveFinding(ztMajor, STATUS.MISSED, { severity: SEVERITY.ZERO_TOLERANCE, note: 'bad' }),
    /requires a note and evidence/,
  );
  // no note
  assert.throws(
    () => deriveFinding(ztMajor, STATUS.MISSED, { severity: SEVERITY.ZERO_TOLERANCE, evidence: 'p.jpg' }),
    /requires a note and evidence/,
  );
});

test('zeroToleranceProblems lists every unmet condition', () => {
  const problems = zeroToleranceProblems(major, STATUS.PARTIAL, null);
  assert.ok(problems.some((p) => p.includes('not Zero Tolerance eligible')));
  assert.ok(problems.some((p) => p.includes('status must be')));
  assert.ok(problems.some((p) => p.includes('explicit auditor escalation')));
  assert.equal(zeroToleranceProblems(ztMajor, STATUS.MISSED, {
    severity: SEVERITY.ZERO_TOLERANCE, note: 'n', evidence: 'e.jpg',
  }).length, 0);
});

test('auditor may raise a finding but never lower one', () => {
  // ARR-01 derives Major on Missed. Raising to Critical is allowed.
  assert.equal(deriveFinding(major, STATUS.MISSED, { severity: SEVERITY.CRITICAL }).severity, SEVERITY.CRITICAL);
  // Lowering has no path at all: removing a Critical used to cost nothing.
  assert.throws(() => deriveFinding(major, STATUS.MISSED, { severity: SEVERITY.MINOR }), /never lowered/);
  assert.throws(() => deriveFinding(critical, STATUS.MISSED, { severity: SEVERITY.MAJOR }), /never lowered/);
  // ARR-03 derives Minor; Critical is two steps away.
  assert.throws(
    () => deriveFinding(minor, STATUS.MISSED, { severity: SEVERITY.CRITICAL }),
    /never lowered/,
  );
  assert.throws(
    () => deriveFinding(minor, STATUS.MISSED, { severity: 'apocalyptic' }),
    /unknown severity/,
  );
});
