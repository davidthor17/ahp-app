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
  WEIGHT_CLASS,
  STRUCTURAL_NA_CAP_PCT,
  FOUNDATION_ALLOWANCE,
  SPOT_CORE_SECTIONS,
  SPOT_MIN_ADDITIONAL_SECTIONS,
  AUDIT_TYPE,
} from './weights.js';

/**
 * @param {object} scoreResult  the object returned by score()
 * @param {object} context      { auditType, category }
 */
export function certify(scoreResult, context = {}) {
  const auditType = context.auditType || DEFAULT_AUDIT_TYPE;
  const scopeSections = context.scopeSections || null;
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

  // Structural N/A erases items from the audit, so beyond the cap the result is
  // no longer a statement about the property. It blocks like a finding does.
  const structuralNaBlocker = scoreResult.structuralNaCapExceeded
    ? [`Too much of the audit was excluded as not applicable: ${scoreResult.structuralNaShare}% of the property, against a ${STRUCTURAL_NA_CAP_PCT}% limit`]
    : [];

  const blockers = [
    ...zeroToleranceFindings.map((f) => `Zero Tolerance: ${f.itemId} ${f.label}`),
    ...criticalFindings.map((f) => `Critical finding: ${f.itemId} ${f.label}`),
    ...structuralNaBlocker,
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

  // ── Assessment states, kept apart on purpose ─────────────────────────────
  //
  // These used to collapse into one branch that said "No graded items" even
  // when ninety nine items had been graded. Each state now names itself, so an
  // auditor is never sent looking for the wrong problem.
  const overallAssessment = scoreResult.assessment || null;
  const foundationAssessment = scoreResult.assessmentByClass
    ? scoreResult.assessmentByClass[WEIGHT_CLASS.FOUNDATION]
    : null;

  const outcome = assessmentOutcome(overallAssessment, foundationAssessment, overall, foundation);
  if (outcome) {
    return {
      ...base,
      level: NO_CERTIFICATION.id,
      label: NO_CERTIFICATION.label,
      eligible: false,
      outcome: outcome.code,
      reasons: [outcome.reason],
      blockers,
      thresholds: null,
      measured: {
        overall,
        foundation,
        coverage,
        assessment: overallAssessment,
        foundationAssessment,
      },
      evaluations: [],
    };
  }

  const foundationUnavailable = scoreResult.foundationUnavailable ?? 0;
  const spotScope = spotScopeEligibility(auditType, scopeSections);

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
      { name: 'excluded share', required: STRUCTURAL_NA_CAP_PCT, actual: scoreResult.structuralNaShare ?? 0, pass: !scoreResult.structuralNaCapExceeded },
      { name: 'fundamentals assessed', required: FOUNDATION_ALLOWANCE[level.id], actual: foundationUnavailable, pass: foundationUnavailable <= FOUNDATION_ALLOWANCE[level.id] },
      { name: 'spot scope', required: null, actual: spotScope, pass: spotScope.eligible },
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
    outcome: achieved ? 'AWARDED' : blockers.length ? 'BLOCKED' : 'BELOW_REQUIREMENT',
    reasons: buildReasons(evaluations, achieved),
    blockers,
    thresholds: achieved ? levelThresholds(achieved) : levelThresholds(CERTIFICATION_LEVELS[0]),
    foundationAssessment: {
      applicable: scoreResult.foundationApplicable ?? null,
      graded: scoreResult.foundationGraded ?? null,
      unavailable: foundationUnavailable,
      unavailableItems: scoreResult.foundationUnavailableItems || [],
      eligibleFor: CERTIFICATION_LEVELS.filter((l) => foundationUnavailable <= FOUNDATION_ALLOWANCE[l.id]).map((l) => l.id),
    },
    foundationAssessmentEligible: foundationUnavailable <= FOUNDATION_ALLOWANCE.certified,
    spotScope,
    measured: {
      overall,
      foundation,
      coverage,
      foundationUnavailable,
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

/**
 * Which "cannot be scored yet" state, if any, the audit is in.
 * Returns null when there is a real score to evaluate.
 *
 *   NO_APPLICABLE_ITEMS        nothing in the catalogue applies to this property
 *   NO_ITEMS_GRADED            it applies, and nothing was assessed
 *   NO_FOUNDATION_APPLICABLE   no Foundation item applies, so there is no floor
 *   FOUNDATION_NOT_GRADED      Foundation applies and none of it was assessed
 */
function assessmentOutcome(overallAssessment, foundationAssessment, overall, foundation) {
  if (overallAssessment && overallAssessment.state === 'no_applicable') {
    return { code: 'NO_APPLICABLE_ITEMS', reason: 'No items in the checklist apply to this property, so no assessment could be made' };
  }
  if (overall === null || (overallAssessment && overallAssessment.state === 'none_graded')) {
    return { code: 'NO_ITEMS_GRADED', reason: 'No items have been assessed yet' };
  }
  if (foundationAssessment && foundationAssessment.state === 'no_applicable') {
    return { code: 'NO_FOUNDATION_APPLICABLE', reason: 'No fundamentals apply to this property, so the Foundation requirement cannot be judged' };
  }
  if (foundation === null || (foundationAssessment && foundationAssessment.state === 'none_graded')) {
    const n = foundationAssessment ? foundationAssessment.itemsApplicable : 0;
    return {
      code: 'FOUNDATION_NOT_GRADED',
      reason: `Items were assessed, but none of the ${n} fundamentals were. Certification cannot be judged without them`,
    };
  }
  return null;
}

/**
 * Is a Spot Audit's declared scope wide enough to certify against?
 *
 * A Spot Audit measures coverage against its own scope, which makes a narrow
 * scope trivially easy to score well on. A scope of Pre-Arrival, Reception and
 * Departure touches two of the thirty four fundamentals and used to reach
 * Certified on that basis.
 *
 * The core carries eleven fundamentals at every property profile, because none
 * of the three sections is behind a facility gate. Anything outside a Spot
 * Audit is unaffected: a Full Audit covers the whole catalogue by definition.
 */
export function spotScopeEligibility(auditType, scopeSections) {
  if (auditType !== AUDIT_TYPE.SPOT) return { applies: false, eligible: true, missingCore: [], additional: null };
  // A Spot Audit that declared no scope is scored against the whole property,
  // so it necessarily contains the core.
  if (!Array.isArray(scopeSections) || scopeSections.length === 0) {
    return { applies: true, eligible: true, missingCore: [], additional: null, undeclared: true };
  }
  const missingCore = SPOT_CORE_SECTIONS.filter((s) => !scopeSections.includes(s));
  const additional = scopeSections.filter((s) => !SPOT_CORE_SECTIONS.includes(s)).length;
  return {
    applies: true,
    eligible: missingCore.length === 0 && additional >= SPOT_MIN_ADDITIONAL_SECTIONS,
    missingCore,
    additional,
    requiredAdditional: SPOT_MIN_ADDITIONAL_SECTIONS,
  };
}

const SECTION_NAMES = {
  room: 'Room Quality',
  bathroom: 'Bathroom',
  safety: 'Safety, Security & Integrity',
};

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
    case 'excluded share':
      return `${prefix}${condition.actual}% of the property was excluded as not applicable, against a ${condition.required}% limit`;
    case 'fundamentals assessed':
      // Deliberately worded as incompleteness, not as a score penalty. The
      // property is not being marked down, the audit is not finished.
      return condition.required === 0
        ? `${prefix}${condition.actual} of the fundamentals ${condition.actual === 1 ? 'was' : 'were'} not assessed, and this level requires all of them`
        : `${prefix}${condition.actual} of the fundamentals were not assessed, and this level allows at most ${condition.required}`;
    case 'spot scope': {
      const s = condition.actual;
      if (s.missingCore && s.missingCore.length) {
        return `${prefix}a Spot Audit must include ${s.missingCore.map((x) => SECTION_NAMES[x] || x).join(' and ')} to be eligible`;
      }
      return `${prefix}a Spot Audit must cover at least ${s.requiredAdditional} areas beyond the required three, this one covers ${s.additional}`;
    }
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
