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
  WEIGHT_CLASSES,
  DIMENSIONS,
  SEVERITY,
} from './weights.js';
import { applicableItems } from './catalog.js';
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

    entries.push({
      itemId: item.id,
      sectionId: item.sectionId,
      weightClass: item.meta.weightClass,
      dimension: item.meta.dimension,
      weight: item.weight,
      status,
      na,
      graded: isGraded,
      value: isGraded ? STATUS_VALUE[status] : 0,
    });

    if (!isGraded) continue;

    const escalation = firstEscalation(byShift);
    try {
      const finding = deriveFinding(item, status, escalation);
      if (finding) findings.push(finding);
    } catch (err) {
      if (!(err instanceof InvalidEscalationError)) throw err;
      // An invalid escalation is reported, never silently honoured. The
      // derived finding still stands so the audit remains scoreable.
      escalationErrors.push({ itemId: item.id, message: err.message, details: err.details });
      const fallback = deriveFinding(item, status, null);
      if (fallback) findings.push(fallback);
    }
  }

  const applicableWeight = entries.reduce((a, e) => a + e.weight, 0);
  const naWeight = entries.reduce((a, e) => a + (e.na ? e.weight : 0), 0);
  const gradedWeight = entries.reduce((a, e) => a + (e.graded ? e.weight : 0), 0);
  const inScopeWeight = applicableWeight - naWeight;
  const { score: overall, numerator } = weightedScore(entries);

  const findingCounts = countBy(findings);
  const zeroToleranceItems = findings
    .filter((f) => f.severity === SEVERITY.ZERO_TOLERANCE)
    .map((f) => f.itemId);

  const sectionIds = [...new Set(entries.map((e) => e.sectionId))];

  return {
    overall,
    overallOfApplicable: inScopeWeight ? round1((numerator / inScopeWeight) * 100) : null,
    coverage: inScopeWeight ? round1((gradedWeight / inScopeWeight) * 100) : 0,
    naShare: applicableWeight ? round1((naWeight / applicableWeight) * 100) : 0,

    weights: {
      applicable: applicableWeight,
      inScope: inScopeWeight,
      graded: gradedWeight,
      na: naWeight,
      ungraded: inScopeWeight - gradedWeight,
    },

    byClass: subscores(entries, 'weightClass', WEIGHT_CLASSES),
    byDimension: subscores(entries, 'dimension', DIMENSIONS),
    bySection: subscores(entries, 'sectionId', sectionIds),

    findings,
    findingCounts,
    zeroToleranceTriggered: zeroToleranceItems.length > 0,
    zeroToleranceItems,
    escalationErrors,

    counts: {
      applicable: entries.length,
      graded: entries.filter((e) => e.graded).length,
      na: entries.filter((e) => e.na).length,
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

function countBy(findings) {
  const out = { minor: 0, major: 0, critical: 0, zero_tolerance: 0 };
  for (const f of findings) out[f.severity] = (out[f.severity] || 0) + 1;
  return out;
}

export { weightedScore, CLASS_WEIGHT };
