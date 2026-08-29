// The weighted scoring engine.
//
// One pass builds a list of scored entries; every subscore, by weight class,
// by dimension, by section, is the same weighted mean over a filtered view of
// that list. There is no separate arithmetic per dimension.
//
// Two denominators, deliberately kept apart:
//
//   overall               numerator / graded weight
//                         a quality score. What proportion of what was
//                         actually assessed was met. Certification uses this.
//
//   overallOfApplicable   numerator / (applicable weight - N/A weight)
//                         ungraded items count as zero. Reported so the effect
//                         of incomplete coverage is visible, never hidden.
//
//   coverage              graded weight / (applicable weight - N/A weight)
//
// Coverage can therefore never inflate the score: it is a separate fraction,
// and the two are always reported together.

import {
  STATUS,
  STATUS_VALUE,
  GRADED_STATUSES,
  CLASS_WEIGHT,
  WEIGHT_CLASS,
  WEIGHT_CLASSES,
  DIMENSIONS,
  SEVERITY,
  STRUCTURAL_NA_REASONS,
  LEGACY_NA_REASON,
  STRUCTURAL_NA_CAP_PCT,
} from './weights.js';
import { applicableItems, rankOf } from './catalog.js';
import { deriveFinding, worstStatus, InvalidEscalationError } from './findings.js';

const round1 = (n) => Math.round(n * 10) / 10;

/** Weighted mean over entries, as a percentage. Null when nothing is graded. */
function weightedScore(entries) {
  let numerator = 0;
  let weight = 0;
  for (const e of entries) {
    if (!e.graded) continue;
    numerator += e.value * e.weight;
    weight += e.weight;
  }
  if (weight === 0) return { score: null, numerator: 0, weight: 0 };
  return { score: round1((numerator / weight) * 100), numerator, weight };
}

function subscores(entries, key, keys) {
  const out = {};
  for (const k of keys) {
    const view = entries.filter((e) => e[key] === k);
    const { score, weight } = weightedScore(view);
    out[k] = { score, gradedWeight: weight, applicableWeight: view.reduce((a, e) => a + (e.na ? 0 : e.weight), 0) };
  }
  return out;
}

/**
 * Score an audit.
 *
 * @param {object} graded   { [itemId]: { [shiftId]: { status, note, escalation } } }
 * @param {object} profile  { category, hasRestaurant, hasPool, hasSpa }
 * @param {object} options  { sections, scopeSections }
 */
export function score(graded = {}, profile = {}, options = {}) {
  const items = applicableItems(profile, options);
  const entries = [];
  const findings = [];
  const escalationErrors = [];

  for (const item of items) {
    const byShift = graded[item.id] || null;
    const status = worstStatus(byShift);
    const na = status === STATUS.NA;
    const isGraded = GRADED_STATUSES.includes(status);
    // A structural N/A takes the item out of the audit. An observational one
    // leaves it in scope and unassessed, so it costs coverage like any other
    // item nobody looked at. An N/A with no reason is read as observational.
    const naReason = na ? (naReasonOf(byShift) || LEGACY_NA_REASON) : null;
    const structural = na && STRUCTURAL_NA_REASONS.includes(naReason);

    entries.push({
      itemId: item.id,
      sectionId: item.sectionId,
      weightClass: item.meta.weightClass,
      dimension: item.meta.dimension,
      weight: item.weight,
      status,
      na,
      naReason,
      structural,
      graded: isGraded,
      value: isGraded ? STATUS_VALUE[status] : 0,
    });

    if (!isGraded) continue;

    const escalation = firstEscalation(byShift);
    // What the auditor wrote against the item, so a finding carries its own
    // evidence. An escalation note, where one exists, takes precedence.
    const observation = firstNote(byShift);
    try {
      const finding = deriveFinding(item, status, escalation);
      if (finding) findings.push(withObservation(finding, observation));
    } catch (err) {
      if (!(err instanceof InvalidEscalationError)) throw err;
      // An invalid escalation is reported, never silently honoured. The
      // derived finding still stands so the audit remains scoreable.
      escalationErrors.push({ itemId: item.id, message: err.message, details: err.details });
      const fallback = deriveFinding(item, status, null);
      if (fallback) findings.push(withObservation(fallback, observation));
    }
  }

  const applicableWeight = entries.reduce((a, e) => a + e.weight, 0);
  const naWeight = entries.reduce((a, e) => a + (e.na ? e.weight : 0), 0);
  const structuralNaWeight = entries.reduce((a, e) => a + (e.structural ? e.weight : 0), 0);
  const observedNaWeight = naWeight - structuralNaWeight;
  const gradedWeight = entries.reduce((a, e) => a + (e.graded ? e.weight : 0), 0);
  // Only structural N/A leaves the coverage denominator. Observational N/A
  // stays in it and therefore costs coverage, which is what stops N/A being a
  // free eraser without punishing a property that genuinely has no spa.
  const inScopeWeight = applicableWeight - structuralNaWeight;
  const { score: overall, numerator } = weightedScore(entries);

  const findingCounts = countBy(findings);
  const zeroToleranceItems = findings
    .filter((f) => f.severity === SEVERITY.ZERO_TOLERANCE)
    .map((f) => f.itemId);

  const sectionIds = [...new Set(entries.map((e) => e.sectionId))];

  return {
    // Carried through so certification can apply the property tier rule
    // without the caller having to pass the profile twice.
    profile: { category: profile.category || null, rank: rankOf(profile) },

    overall,
    overallOfApplicable: inScopeWeight ? round1((numerator / inScopeWeight) * 100) : null,
    coverage: inScopeWeight ? round1((gradedWeight / inScopeWeight) * 100) : 0,
    naShare: applicableWeight ? round1((naWeight / applicableWeight) * 100) : 0,
    // Measured against the full applicable pool, so erasing items cannot also
    // shrink the yardstick the cap is judged by.
    structuralNaShare: applicableWeight ? round1((structuralNaWeight / applicableWeight) * 100) : 0,
    structuralNaCapExceeded: applicableWeight
      ? (structuralNaWeight / applicableWeight) * 100 > STRUCTURAL_NA_CAP_PCT
      : false,
    structuralNaItems: entries.filter((e) => e.structural).map((e) => e.itemId),
    structuralNaFoundationItems: entries
      .filter((e) => e.structural && e.weightClass === WEIGHT_CLASS.FOUNDATION)
      .map((e) => e.itemId),

    weights: {
      applicable: applicableWeight,
      inScope: inScopeWeight,
      graded: gradedWeight,
      na: naWeight,
      structuralNa: structuralNaWeight,
      observedNa: observedNaWeight,
      ungraded: inScopeWeight - gradedWeight,
    },

    byClass: subscores(entries, 'weightClass', WEIGHT_CLASSES),
    byDimension: subscores(entries, 'dimension', DIMENSIONS),
    bySection: subscores(entries, 'sectionId', sectionIds),
    assessment: assessmentOf(entries),
    assessmentByClass: WEIGHT_CLASSES.reduce((acc, c) => {
      acc[c] = assessmentOf(entries.filter((e) => e.weightClass === c));
      return acc;
    }, {}),

    // ── Foundation assessment completeness ────────────────────────────────
    //
    // Counted in items, because every Foundation item weighs the same. An
    // item is unavailable when it applies under this audit's snapshot but
    // carries no graded status, whether nobody looked at it, it was recorded
    // as not observed, or it was excluded as structurally absent. A gate in
    // the catalogue is different: a sauna that does not exist was never an
    // applicable item, so it costs nothing.
    ...foundationAvailability(entries),

    findings,
    findingCounts,
    zeroToleranceTriggered: zeroToleranceItems.length > 0,
    zeroToleranceItems,
    escalationErrors,

    counts: {
      applicable: entries.length,
      graded: entries.filter((e) => e.graded).length,
      na: entries.filter((e) => e.na).length,
      structuralNa: entries.filter((e) => e.structural).length,
      observedNa: entries.filter((e) => e.na && !e.structural).length,
      ungraded: entries.filter((e) => !e.graded && !e.na).length,
    },
  };
}

function firstEscalation(byShift) {
  if (!byShift) return null;
  for (const entry of Object.values(byShift)) {
    if (entry && entry.escalation && entry.escalation.severity) return entry.escalation;
  }
  return null;
}

function firstNote(byShift) {
  if (!byShift) return null;
  for (const entry of Object.values(byShift)) {
    if (entry && typeof entry.note === 'string' && entry.note.trim()) return entry.note.trim();
  }
  return null;
}

/** The N/A reason recorded against an item, from whichever shift carries one. */
function naReasonOf(byShift) {
  if (!byShift) return null;
  for (const entry of Object.values(byShift)) {
    if (entry && entry.status === STATUS.NA && entry.naReason) return entry.naReason;
  }
  return null;
}

/**
 * How much of a set of items was actually assessed, and what that means.
 *
 *   no_applicable  nothing in this set applies to the property
 *   none_graded    it applies, and none of it was assessed
 *   partial        some of it was assessed
 *   complete       all of it was assessed
 *
 * Structural N/A leaves the set, so it neither counts as assessed nor as a gap.
 */
/**
 * How complete the assessment of the fundamentals is, in items.
 *
 * `foundationApplicable` counts every Foundation item that applies under the
 * audit's snapshot, including ones later excluded as structurally absent,
 * because excluding a fundamental is a claim about the audit rather than a
 * property of the catalogue and should not shrink the yardstick.
 */
function foundationAvailability(entries) {
  const f = entries.filter((e) => e.weightClass === WEIGHT_CLASS.FOUNDATION);
  const applicable = f.length;
  const graded = f.filter((e) => e.graded).length;
  return {
    foundationApplicable: applicable,
    foundationGraded: graded,
    foundationUnavailable: applicable - graded,
    foundationUnavailableItems: f.filter((e) => !e.graded).map((e) => e.itemId),
  };
}

function assessmentOf(entries) {
  const inScope = entries.filter((e) => !e.structural);
  const applicableWeight = inScope.reduce((a, e) => a + e.weight, 0);
  const gradedWeight = inScope.reduce((a, e) => a + (e.graded ? e.weight : 0), 0);

  let state;
  if (entries.length === 0 || applicableWeight === 0) state = 'no_applicable';
  else if (gradedWeight === 0) state = 'none_graded';
  else if (gradedWeight < applicableWeight) state = 'partial';
  else state = 'complete';

  return {
    state,
    applicableWeight,
    gradedWeight,
    assessedShare: applicableWeight ? round1((gradedWeight / applicableWeight) * 100) : null,
    itemsApplicable: inScope.length,
    itemsGraded: inScope.filter((e) => e.graded).length,
  };
}

const withObservation = (finding, observation) =>
  (finding.note ? finding : { ...finding, note: observation });

function countBy(findings) {
  const out = { minor: 0, major: 0, critical: 0, zero_tolerance: 0 };
  for (const f of findings) out[f.severity] = (out[f.severity] || 0) + 1;
  return out;
}

export { weightedScore, CLASS_WEIGHT };
