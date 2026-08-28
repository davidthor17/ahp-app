// Certification evaluation.
//
// Returns the level AND the reasoning, so the console can tell an auditor
// which requirement was missed rather than showing a bare pass or fail.
//
//   reasons   why the awarded level was reached, and what stopped the next
//             one, each stated with the required and the actual value
//   blockers  absolute bars no score can overcome: Critical findings and any
//             Zero Tolerance trigger
//   ceiling   the highest level this audit type and property tier could reach
//             even with a perfect score, so the UI can say so up front
//
// Audit type and certification stay separate concepts, but the type caps how
// high the level can reach:
//
//   Desk Review   no certification level
//   Spot Audit    Certified at most
//   Full Audit    Certified, Exceptional or Elite
//
// v1 has no Major finding cap by design. Major findings are counted and
// reported prominently, and left to be calibrated once more real audits exist.

import {
  CERTIFICATION_LEVELS,
  NO_CERTIFICATION,
  DEFAULT_AUDIT_TYPE,
  SEVERITY,
} from './weights.js';

/**
 * @param {object} scoreResult  the object returned by score()
 * @param {object} context      { auditType, category }
 */
export function certify(scoreResult, context = {}) {
  const auditType = context.auditType || DEFAULT_AUDIT_TYPE;
  const category = context.category
    || (scoreResult.profile && scoreResult.profile.category)
    || null;

  const overall = scoreResult.overall;
  const coverage = scoreResult.coverage;
  const foundation = scoreResult.byClass && scoreResult.byClass.foundation
    ? scoreResult.byClass.foundation.score
    : null;

  const findings = scoreResult.findings || [];
  const criticalFindings = findings.filter((f) => f.severity === SEVERITY.CRITICAL);
  const zeroToleranceFindings = findings.filter((f) => f.severity === SEVERITY.ZERO_TOLERANCE);
  const majorFindings = findings.filter((f) => f.severity === SEVERITY.MAJOR);

  const blockers = [
    ...zeroToleranceFindings.map((f) => `Zero Tolerance: ${f.itemId} ${f.label}`),
    ...criticalFindings.map((f) => `Critical finding: ${f.itemId} ${f.label}`),
  ];

  // Highest level this audit could reach on eligibility alone, before scores.
  const reachable = CERTIFICATION_LEVELS.filter(
    (l) => allowsAuditType(l, auditType) && allowsCategory(l, category),
  );
  const ceiling = reachable.length ? reachable[reachable.length - 1] : NO_CERTIFICATION;

  const base = {
    auditType,
    category,
    ceiling: ceiling.id,
    ceilingLabel: ceiling.label,
    majorFindings: majorFindings.length,
  };

  if (overall === null || foundation === null) {
    return {
      ...base,
      level: NO_CERTIFICATION.id,
      label: NO_CERTIFICATION.label,
      eligible: false,
      reasons: ['No graded items, so no score could be produced'],
      blockers,
      thresholds: null,
      measured: { overall, foundation, coverage },
      evaluations: [],
    };
  }

  let achieved = null;
  const evaluations = CERTIFICATION_LEVELS.map((level) => {
    const conditions = [
      { name: 'auditType', required: level.auditTypes, actual: auditType, pass: allowsAuditType(level, auditType) },
      { name: 'category', required: level.categories, actual: category, pass: allowsCategory(level, category) },
      { name: 'overall score', required: level.minOverall, actual: overall, pass: overall >= level.minOverall },
      { name: 'Foundation score', required: level.minFoundation, actual: foundation, pass: foundation >= level.minFoundation },
      { name: 'coverage', required: level.minCoverage, actual: coverage, pass: coverage >= level.minCoverage },
      { name: 'Critical findings', required: 0, actual: criticalFindings.length, pass: criticalFindings.length === 0 },
      { name: 'Zero Tolerance triggers', required: 0, actual: zeroToleranceFindings.length, pass: zeroToleranceFindings.length === 0 },
    ];
    const pass = conditions.every((c) => c.pass);
    if (pass) achieved = level;
    return { level, conditions, pass };
  });

  const awarded = achieved || NO_CERTIFICATION;

  return {
    ...base,
    level: awarded.id,
    label: awarded.label,
    eligible: Boolean(achieved),
    reasons: buildReasons(evaluations, achieved),
    blockers,
    thresholds: achieved ? levelThresholds(achieved) : levelThresholds(CERTIFICATION_LEVELS[0]),
    measured: {
      overall,
      foundation,
      coverage,
      criticalFindings: criticalFindings.length,
      majorFindings: majorFindings.length,
      zeroToleranceTriggers: zeroToleranceFindings.length,
    },
    evaluations: evaluations.map((e) => ({
      level: e.level.id,
      pass: e.pass,
      failed: e.conditions.filter((c) => !c.pass).map((c) => c.name),
    })),
  };
}

const allowsAuditType = (level, auditType) => level.auditTypes.includes(auditType);
const allowsCategory = (level, category) => !level.categories || level.categories.includes(category);
const levelThresholds = (l) => ({
  minOverall: l.minOverall,
  minFoundation: l.minFoundation,
  minCoverage: l.minCoverage,
});

function buildReasons(evaluations, achieved) {
  if (!achieved) {
    // Explain against the entry level: those are the conditions that matter.
    return evaluations[0].conditions
      .filter((c) => !c.pass)
      .map((c) => describeFailure(c, evaluations[0].level));
  }

  const reasons = [`Meets ${achieved.label}: every requirement satisfied`];
  // Say what stopped the next level up, when there is one.
  const next = evaluations.find(
    (e) => !e.pass && e.level.minOverall >= achieved.minOverall && e.level.id !== achieved.id,
  );
  if (next) {
    for (const c of next.conditions.filter((x) => !x.pass)) {
      reasons.push(describeFailure(c, next.level, `Not ${next.level.label}: `));
    }
  }
  return reasons;
}

function describeFailure(condition, level, prefix = '') {
  switch (condition.name) {
    case 'auditType':
      return `${prefix}${auditTypeLabel(condition.actual)} cannot receive ${level.label}`;
    case 'category':
      return `${prefix}${level.label} is available to ${condition.required.join(' and ')} properties only, this one is ${condition.actual || 'uncategorised'}`;
    case 'Critical findings':
      return `${prefix}${condition.actual} Critical finding${condition.actual === 1 ? '' : 's'} recorded, none permitted`;
    case 'Zero Tolerance triggers':
      return `${prefix}${condition.actual} Zero Tolerance trigger${condition.actual === 1 ? '' : 's'} recorded, none permitted`;
    default:
      return `${prefix}${cap(condition.name)} ${condition.actual}% is below the ${condition.required}% required for ${level.label}`;
  }
}

function auditTypeLabel(type) {
  if (type === 'desk') return 'A Desk Review';
  if (type === 'spot') return 'A Spot Audit';
  if (type === 'full') return 'A Full Audit';
  return `An audit of type "${type}"`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
