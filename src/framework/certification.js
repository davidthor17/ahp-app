// Certification evaluation.
//
// Returns the level AND the reasoning, so the console can tell an auditor
// which floor was missed rather than showing a bare pass or fail.
//
//   reasons   why the awarded level was or was not reached: the score
//             conditions, each stated with the required and actual value
//   blockers  absolute bars that no score can overcome: Critical findings and
//             any Zero Tolerance trigger
//
// Certification is independent of audit type. The audit type is carried
// through on the result for the caller to use, but no rule here gates on it.

import { CERTIFICATION_LEVELS, NO_CERTIFICATION, SEVERITY } from './weights.js';

/**
 * @param {object} scoreResult  the object returned by score()
 * @param {object} context      { auditType }
 */
export function certify(scoreResult, context = {}) {
  const overall = scoreResult.overall;
  const foundation = scoreResult.byClass.foundation
    ? scoreResult.byClass.foundation.score
    : null;

  const criticalFindings = (scoreResult.findings || []).filter(
    (f) => f.severity === SEVERITY.CRITICAL,
  );
  const zeroToleranceFindings = (scoreResult.findings || []).filter(
    (f) => f.severity === SEVERITY.ZERO_TOLERANCE,
  );

  const blockers = [
    ...zeroToleranceFindings.map((f) => `Zero Tolerance: ${f.itemId} ${f.label}`),
    ...criticalFindings.map((f) => `Critical finding: ${f.itemId} ${f.label}`),
  ];

  if (overall === null || foundation === null) {
    return {
      level: NO_CERTIFICATION.id,
      label: NO_CERTIFICATION.label,
      eligible: false,
      auditType: context.auditType || null,
      reasons: ['No graded items, so no score could be produced'],
      blockers,
      thresholds: null,
      measured: { overall, foundation },
    };
  }

  // Walk weakest to strongest and keep the highest level fully satisfied.
  let achieved = null;
  const evaluations = CERTIFICATION_LEVELS.map((level) => {
    const conditions = [
      { name: 'overall score', required: level.minOverall, actual: overall, pass: overall >= level.minOverall },
      { name: 'Foundation score', required: level.minFoundation, actual: foundation, pass: foundation >= level.minFoundation },
      { name: 'Critical findings', required: 0, actual: criticalFindings.length, pass: criticalFindings.length === 0 },
      { name: 'Zero Tolerance triggers', required: 0, actual: zeroToleranceFindings.length, pass: zeroToleranceFindings.length === 0 },
    ];
    const pass = conditions.every((c) => c.pass);
    if (pass) achieved = level;
    return { level, conditions, pass };
  });

  const awarded = achieved || NO_CERTIFICATION;
  const reasons = buildReasons(evaluations, achieved);

  return {
    level: awarded.id,
    label: awarded.label,
    eligible: Boolean(achieved),
    auditType: context.auditType || null,
    reasons,
    blockers,
    thresholds: achieved
      ? { minOverall: achieved.minOverall, minFoundation: achieved.minFoundation }
      : { minOverall: CERTIFICATION_LEVELS[0].minOverall, minFoundation: CERTIFICATION_LEVELS[0].minFoundation },
    measured: {
      overall,
      foundation,
      criticalFindings: criticalFindings.length,
      zeroToleranceTriggers: zeroToleranceFindings.length,
    },
    evaluations: evaluations.map((e) => ({
      level: e.level.id,
      pass: e.pass,
      failed: e.conditions.filter((c) => !c.pass).map((c) => c.name),
    })),
  };
}

function buildReasons(evaluations, achieved) {
  if (!achieved) {
    // Explain against the entry level: those are the conditions that matter.
    return evaluations[0].conditions
      .filter((c) => !c.pass)
      .map((c) => describeFailure(c, evaluations[0].level));
  }

  const reasons = [
    `Meets ${achieved.label}: overall and Foundation both at or above the required minimum, with no Critical findings and no Zero Tolerance trigger`,
  ];
  // Say what stopped the next level up, when there is one.
  const next = evaluations.find((e) => !e.pass && e.level.minOverall > achieved.minOverall);
  if (next) {
    for (const c of next.conditions.filter((x) => !x.pass)) {
      reasons.push(describeFailure(c, next.level, 'Not ' + next.level.label + ': '));
    }
  }
  return reasons;
}

function describeFailure(condition, level, prefix = '') {
  if (condition.name === 'Critical findings') {
    return `${prefix}${condition.actual} Critical finding${condition.actual === 1 ? '' : 's'} recorded, none permitted`;
  }
  if (condition.name === 'Zero Tolerance triggers') {
    return `${prefix}${condition.actual} Zero Tolerance trigger${condition.actual === 1 ? '' : 's'} recorded, none permitted`;
  }
  return `${prefix}${cap(condition.name)} ${condition.actual}% is below the ${condition.required}% required for ${level.label}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
