// Findings are DERIVED from the assessment, never stored beside it.
//
// This is the structural fix for the defect in the current console, where
// `critical` is a boolean an auditor toggles independently of the status. The
// live database contains critical flags on items whose status is null. Under
// this model such a finding cannot exist: a finding is a function of the
// status, so no failing status means no finding.
//
//   met      no finding
//   na       no finding
//   ungraded no finding
//   missed   finding at the item's default severity
//   partial  finding one step below the default, floored at Minor
//
// Zero Tolerance is never derived. It requires an eligible item, a Missed
// status, an explicit auditor escalation, and evidence.

import {
  STATUS,
  SEVERITY,
  SEVERITY_LADDER,
  DEFAULT_SEVERITIES,
  STATUS_SEVERITY_ORDER,
} from './weights.js';

export class InvalidEscalationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidEscalationError';
    this.details = details;
  }
}

/** Step a severity down one rung, floored at Minor. Critical -> Major -> Minor. */
export function stepDown(severity) {
  const i = SEVERITY_LADDER.indexOf(severity);
  if (i <= 0) return SEVERITY.MINOR;
  return SEVERITY_LADDER[i - 1];
}

/** Step a severity up one rung, capped at Critical. Never reaches Zero Tolerance. */
export function stepUp(severity) {
  const i = SEVERITY_LADDER.indexOf(severity);
  if (i < 0) return SEVERITY.MINOR;
  return SEVERITY_LADDER[Math.min(i + 1, SEVERITY_LADDER.length - 1)];
}

/** The severity a status produces for an item, before any escalation. */
export function derivedSeverity(status, defaultSeverity) {
  if (status === STATUS.MISSED) return defaultSeverity;
  if (status === STATUS.PARTIAL) return stepDown(defaultSeverity);
  return null;
}

/**
 * Worst status an item received across its shifts.
 * Returns null when the item was never graded at all.
 */
export function worstStatus(byShift) {
  if (!byShift) return null;
  let worst = null;
  for (const entry of Object.values(byShift)) {
    const status = entry && entry.status;
    if (!status) continue;
    if (worst === null || STATUS_SEVERITY_ORDER[status] > STATUS_SEVERITY_ORDER[worst]) {
      worst = status;
    }
  }
  return worst;
}

/**
 * Does this escalation request describe a valid Zero Tolerance trigger?
 * All four conditions must hold. Returns a list of reasons it does not.
 */
export function zeroToleranceProblems(item, status, escalation) {
  const problems = [];
  if (!item || !item.meta || !item.meta.zeroToleranceEligible) {
    problems.push('item is not Zero Tolerance eligible');
  }
  if (status !== STATUS.MISSED) {
    problems.push(`status must be "${STATUS.MISSED}", got "${status ?? 'ungraded'}"`);
  }
  if (!escalation || escalation.severity !== SEVERITY.ZERO_TOLERANCE) {
    problems.push('requires an explicit auditor escalation');
  }
  if (escalation && escalation.severity === SEVERITY.ZERO_TOLERANCE && !hasEvidence(escalation)) {
    problems.push('requires a note and evidence');
  }
  return problems;
}

function hasEvidence(escalation) {
  const note = typeof escalation.note === 'string' ? escalation.note.trim() : '';
  const evidence = escalation.evidence ?? escalation.photo ?? null;
  return note.length > 0 && Boolean(evidence);
}

/**
 * Derive the finding for one item.
 *
 * @param {object} item      catalogue item joined to its metadata
 * @param {string|null} status  worst status across shifts, or null if ungraded
 * @param {object|null} escalation  optional { severity, note, evidence }
 * @returns {object|null} the finding, or null when the status raises none
 * @throws {InvalidEscalationError} when an escalation is requested but invalid
 */
export function deriveFinding(item, status, escalation = null) {
  if (!item || !item.meta) {
    throw new InvalidEscalationError(`no framework metadata for item "${item && item.id}"`, { itemId: item && item.id });
  }

  const base = derivedSeverity(status, item.meta.defaultSeverity);

  if (!escalation || !escalation.severity) {
    if (base === null) return null;
    return makeFinding(item, status, base, false, null);
  }

  // An escalation on an item that raises no finding is always invalid: it
  // would recreate exactly the defect this model exists to remove.
  if (base === null) {
    throw new InvalidEscalationError(
      `cannot escalate ${item.id}: status "${status ?? 'ungraded'}" raises no finding`,
      { itemId: item.id, status, requested: escalation.severity },
    );
  }

  if (escalation.severity === SEVERITY.ZERO_TOLERANCE) {
    const problems = zeroToleranceProblems(item, status, escalation);
    if (problems.length) {
      throw new InvalidEscalationError(
        `invalid Zero Tolerance escalation on ${item.id}: ${problems.join('; ')}`,
        { itemId: item.id, status, problems },
      );
    }
    return makeFinding(item, status, SEVERITY.ZERO_TOLERANCE, true, escalation);
  }

  if (!DEFAULT_SEVERITIES.includes(escalation.severity)) {
    throw new InvalidEscalationError(
      `unknown severity "${escalation.severity}" on ${item.id}`,
      { itemId: item.id, requested: escalation.severity },
    );
  }

  // The auditor may move the finding one rung either way within Minor..Critical.
  const allowed = new Set([base, stepUp(base), stepDown(base)]);
  if (!allowed.has(escalation.severity)) {
    throw new InvalidEscalationError(
      `severity "${escalation.severity}" on ${item.id} is more than one step from the derived "${base}"`,
      { itemId: item.id, derived: base, requested: escalation.severity },
    );
  }

  return makeFinding(item, status, escalation.severity, escalation.severity !== base, escalation);
}

function makeFinding(item, status, severity, escalated, escalation) {
  return {
    itemId: item.id,
    label: item.label,
    sectionId: item.sectionId,
    sectionLabel: item.sectionLabel,
    weightClass: item.meta.weightClass,
    dimension: item.meta.dimension,
    status,
    severity,
    defaultSeverity: item.meta.defaultSeverity,
    derivedSeverity: derivedSeverity(status, item.meta.defaultSeverity),
    escalated,
    source: escalated ? 'auditor' : 'derived',
    note: (escalation && escalation.note) || null,
    evidence: (escalation && (escalation.evidence ?? escalation.photo)) || null,
  };
}
