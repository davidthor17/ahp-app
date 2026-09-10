// Phase 6.5 — Audit Intelligence Foundation.
//
// A deterministic aggregation layer over an already-scored audit. Nothing
// here derives a finding, computes a score, or decides a severity: those
// stay exactly where they are, in findings.js and scoring.js. This module
// answers a different question — given the findings an audit already has,
// what should the auditor look at first, what did they get genuinely right,
// and where do the individual findings connect into something bigger than
// any one of them.
//
//   AUDIT ITEMS -> SCORING -> deriveFinding() -> findings -> (this module)
//                                                              |
//                                              findings, priorities,
//                                              strengths, patterns,
//                                              summaryMetrics
//
// Pure, deterministic, side-effect free, independent of React. Two inputs:
//
//   scoreResult   the object score() already returned. Reused, not
//                 recomputed: findings, bySection, findingCounts and counts
//                 all come from here unchanged.
//   audit/profile/options
//                 the same three arguments the caller already passed to
//                 score(), so this module can ask applicableItems() and
//                 worstStatus() — both already canonical — how many items
//                 were actually assessed per section. score() does not
//                 return that broken down by section (only by weight), and
//                 a strength claim needs a real item count, not a weight.
//
// Deliberately not attempted here: any pattern that would require knowing
// which sections form one "guest journey" (arrival, dining, departure...).
// No such grouping exists in the catalogue — sectionId and dimension are
// the only two structured axes an item actually carries — so the only
// cross-section pattern this module raises is grouped by dimension, which
// is real metadata on every finding. Semantic clustering of any kind is
// left for an AI phase; nothing here approximates it.

import { STATUS, GRADED_STATUSES, SEVERITY } from './weights.js';
import { applicableItems } from './catalog.js';
import { worstStatus } from './findings.js';

const SEVERITY_RANK = Object.freeze({
  [SEVERITY.ZERO_TOLERANCE]: 3,
  [SEVERITY.CRITICAL]: 2,
  [SEVERITY.MAJOR]: 1,
  [SEVERITY.MINOR]: 0,
});

const SEVERITY_LABEL = Object.freeze({
  [SEVERITY.ZERO_TOLERANCE]: 'Zero Tolerance',
  [SEVERITY.CRITICAL]: 'Critical',
  [SEVERITY.MAJOR]: 'Major',
  [SEVERITY.MINOR]: 'Minor',
});

const STATUS_LABEL = Object.freeze({ missed: 'Missed', partial: 'Partial' });

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A strength needs enough of the section actually assessed to mean
// something. Three is the smallest real section in the catalogue (Safety,
// Security & Integrity) — the threshold is chosen so that section can still
// earn a strength on a clean pass, while a one- or two-item sample cannot.
const STRENGTH_MIN_SAMPLE = 3;

// A section contains a genuine mix, not one bad apple in an otherwise clean
// section, when there is real weight on both sides of it.
const CONSISTENCY_MIN_SAMPLE = 4;
const CONSISTENCY_MIN_PROBLEMS = 2;

function groupBy(list, keyFn) {
  const out = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

const worstSeverity = (findings) =>
  findings.reduce((worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst), SEVERITY.MINOR);

const byItemId = (a, b) => a.itemId.localeCompare(b.itemId);

/**
 * Per-section item counts, from the same primitives score() uses.
 *
 * Not a second scoring pass: no weights, no severities, no findings — just
 * how many applicable items in each section landed on which status. This is
 * the one thing score()'s returned shape does not carry (bySection is
 * weight-based, not item-count-based), and a strength claim needs the real
 * count to be traceable rather than approximated from weight.
 */
function sectionItemStats(audit, profile, options) {
  const stats = new Map();
  for (const item of applicableItems(profile, options)) {
    let s = stats.get(item.sectionId);
    if (!s) {
      s = {
        sectionId: item.sectionId, sectionLabel: item.sectionLabel,
        applicable: 0, graded: 0, met: 0, missed: 0, partial: 0, metItemIds: [],
      };
      stats.set(item.sectionId, s);
    }
    s.applicable += 1;
    const status = worstStatus(audit[item.id] || null);
    if (!GRADED_STATUSES.includes(status)) continue;
    s.graded += 1;
    if (status === STATUS.MET) { s.met += 1; s.metItemIds.push(item.id); }
    else if (status === STATUS.MISSED) s.missed += 1;
    else if (status === STATUS.PARTIAL) s.partial += 1;
  }
  return stats;
}

// ── priorities ────────────────────────────────────────────────────────────

/**
 * A ranked, deterministic list of what to address first.
 *
 * Severity is always the primary key — a repeated Minor pattern never
 * outranks an isolated Critical finding. Within one severity, a repeated
 * problem in one section outranks an isolated one, because the same failure
 * recorded twice is more of a priority than once. Zero Tolerance findings
 * are never grouped with each other: each carries its own auditor evidence
 * and stands as its own priority regardless of how many there are.
 */
export function buildPriorities(findings) {
  const zt = findings.filter((f) => f.severity === SEVERITY.ZERO_TOLERANCE);
  const groupable = findings.filter((f) => f.severity !== SEVERITY.ZERO_TOLERANCE);
  const groups = groupBy(groupable, (f) => `${f.sectionId}|${f.severity}`);

  const candidates = [];

  for (const f of [...zt].sort(byItemId)) {
    candidates.push({
      severity: SEVERITY.ZERO_TOLERANCE,
      type: 'zero_tolerance',
      title: `Zero Tolerance: ${f.itemId} ${f.label}`,
      reason: f.note
        ? `Escalated by the auditor in ${f.sectionLabel}: ${f.note}`
        : `Escalated by the auditor in ${f.sectionLabel}.`,
      findingIds: [f.itemId],
      sectionIds: [f.sectionId],
      count: 1,
    });
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort(byItemId);
    const { severity, sectionLabel, sectionId } = sorted[0];
    if (sorted.length >= 2) {
      candidates.push({
        severity,
        type: 'repeated',
        title: `${sorted.length} ${SEVERITY_LABEL[severity]} findings in ${sectionLabel}`,
        reason: `${sorted.length} items in ${sectionLabel} were recorded at ${SEVERITY_LABEL[severity]} severity: ${sorted.map((f) => f.itemId).join(', ')}.`,
        findingIds: sorted.map((f) => f.itemId),
        sectionIds: [sectionId],
        count: sorted.length,
      });
    } else {
      const f = sorted[0];
      candidates.push({
        severity,
        type: 'isolated',
        title: `${SEVERITY_LABEL[severity]} finding: ${f.label}`,
        reason: f.note
          ? `${f.sectionLabel} — ${STATUS_LABEL[f.status] || f.status}, ${SEVERITY_LABEL[severity]}. ${f.note}`
          : `${f.sectionLabel} — ${STATUS_LABEL[f.status] || f.status}, ${SEVERITY_LABEL[severity]}.`,
        findingIds: [f.itemId],
        sectionIds: [f.sectionId],
        count: 1,
      });
    }
  }

  const TYPE_RANK = { zero_tolerance: 2, repeated: 1, isolated: 0 };
  candidates.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    || TYPE_RANK[b.type] - TYPE_RANK[a.type]
    || b.count - a.count
    || a.sectionIds[0].localeCompare(b.sectionIds[0])
    || a.findingIds[0].localeCompare(b.findingIds[0]));

  return candidates.map((c, i) => ({ rank: i + 1, ...c }));
}

// ── strengths ─────────────────────────────────────────────────────────────

/**
 * Sections where every assessed item met the standard, on a sample large
 * enough to mean something.
 *
 * Not "every item marked met" — a section is a strength only when nothing
 * assessed in it fell short, so one Missed item anywhere in the section
 * disqualifies it, exactly as one Missed anywhere disqualifies a claim of
 * consistency in any other reading of the data.
 */
export function buildStrengths(sectionStats, bySection) {
  const out = [];
  for (const s of sectionStats.values()) {
    if (s.graded < STRENGTH_MIN_SAMPLE) continue;
    if (s.met !== s.graded) continue;
    const scored = bySection && bySection[s.sectionId] ? bySection[s.sectionId].score : null;
    out.push({
      sectionId: s.sectionId,
      title: `Consistently strong performance in ${s.sectionLabel}`,
      reason: `${s.met} of ${s.graded} assessed items met the standard in ${s.sectionLabel}, with no missed or partial items.`,
      score: scored,
      assessedCount: s.graded,
      itemIds: [...s.metItemIds].sort(),
    });
  }
  out.sort((a, b) => b.assessedCount - a.assessedCount || a.sectionId.localeCompare(b.sectionId));
  return out;
}

// ── patterns ──────────────────────────────────────────────────────────────

/**
 * Connections between findings that no single finding shows on its own.
 *
 *   repeated_failure         2+ findings in the same section
 *   consistency_gap          a section with real weight on both sides —
 *                             genuinely met items and genuinely missed or
 *                             partial ones, not just one outlier
 *   cross_section_dimension  the same dimension (condition / service /
 *                             product / experience) recorded against 2+
 *                             different sections — the one cross-section
 *                             signal the catalogue actually supports
 */
export function buildPatterns(findings, sectionStats) {
  const patterns = [];

  for (const [sectionId, group] of groupBy(findings, (f) => f.sectionId)) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(byItemId);
    patterns.push({
      type: 'repeated_failure',
      severity: worstSeverity(sorted),
      title: `Repeated issues in ${sorted[0].sectionLabel}`,
      reason: `${sorted.length} items in ${sorted[0].sectionLabel} were not fully met: ${sorted.map((f) => f.itemId).join(', ')}.`,
      findingIds: sorted.map((f) => f.itemId),
      sectionIds: [sectionId],
    });
  }

  for (const s of sectionStats.values()) {
    const problems = s.missed + s.partial;
    if (s.met < 1 || problems < CONSISTENCY_MIN_PROBLEMS || s.graded < CONSISTENCY_MIN_SAMPLE) continue;
    const group = findings.filter((f) => f.sectionId === s.sectionId).sort(byItemId);
    if (!group.length) continue;
    patterns.push({
      type: 'consistency_gap',
      severity: worstSeverity(group),
      title: `Mixed performance in ${s.sectionLabel}`,
      reason: `${s.met} of ${s.graded} assessed items met the standard in ${s.sectionLabel}, alongside ${problems} that did not.`,
      findingIds: group.map((f) => f.itemId),
      sectionIds: [s.sectionId],
    });
  }

  for (const [dimension, group] of groupBy(findings.filter((f) => f.dimension), (f) => f.dimension)) {
    const labelOf = new Map(group.map((f) => [f.sectionId, f.sectionLabel]));
    const sections = [...labelOf.keys()].sort();
    if (sections.length < 2) continue;
    const sorted = [...group].sort(byItemId);
    patterns.push({
      type: 'cross_section_dimension',
      severity: worstSeverity(sorted),
      title: `Repeated ${cap(dimension)} issues across the audit`,
      reason: `${sorted.length} ${cap(dimension)} findings recorded across ${sections.length} sections: ${sections.map((id) => labelOf.get(id)).join(', ')}.`,
      findingIds: sorted.map((f) => f.itemId),
      sectionIds: sections,
    });
  }

  const TYPE_ORDER = { repeated_failure: 0, consistency_gap: 1, cross_section_dimension: 2 };
  patterns.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
    || a.sectionIds[0].localeCompare(b.sectionIds[0]));

  return patterns;
}

// ── summary metrics ──────────────────────────────────────────────────────

/**
 * A compact readout of the audit, built entirely from values score()
 * already computed plus simple counts over its findings array. Nothing
 * here is a second measurement of anything scoring.js already measures.
 */
export function buildSummaryMetrics(scoreResult, priorities, patterns, strengths) {
  const findings = scoreResult.findings || [];
  const counts = scoreResult.counts || {};
  const findingCounts = scoreResult.findingCounts || { minor: 0, major: 0, critical: 0, zero_tolerance: 0 };
  const missedCount = findings.filter((f) => f.status === STATUS.MISSED).length;
  const partialCount = findings.filter((f) => f.status === STATUS.PARTIAL).length;
  const sectionsWithFindings = new Set(findings.map((f) => f.sectionId)).size;

  return {
    overallScore: scoreResult.overall,
    coverage: scoreResult.coverage,
    totalAssessedItems: counts.graded || 0,
    totalFindings: findings.length,
    findingsBySeverity: findingCounts,
    criticalFindings: findingCounts.critical || 0,
    zeroToleranceFindings: findingCounts.zero_tolerance || 0,
    missedCount,
    partialCount,
    // Not Assessed (na, observed) and Not Available (na, structural) are
    // reported as plain counts, never folded into a severity bucket. Neither
    // an unvisited spa nor an absent one is a finding, and this is the one
    // place that distinction has to survive into the summary intact.
    notAssessedCount: counts.observedNa || 0,
    notAvailableCount: counts.structuralNa || 0,
    sectionsWithFindings,
    priorityCount: priorities.length,
    patternCount: patterns.length,
    strengthCount: strengths.length,
  };
}

// ── entry point ───────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {object} input.scoreResult  the object score() already returned
 * @param {object} input.audit       the graded map passed to score()
 * @param {object} input.profile     the property profile passed to score()
 * @param {object} input.options     { scopeSections, checklistItems }, as passed to score()
 *
 * `audit`/`profile`/`options` are optional: findings, priorities, patterns
 * and summaryMetrics are all derivable from scoreResult alone. Without them
 * strengths is always empty rather than approximated, because a strength
 * claim needs a real per-section item count that scoreResult does not carry.
 */
export function analyzeAuditIntelligence({ scoreResult, audit = {}, profile = {}, options = {} } = {}) {
  const findings = (scoreResult && scoreResult.findings) || [];
  const sectionStats = sectionItemStats(audit, profile, options);

  const priorities = buildPriorities(findings);
  const strengths = sectionStats.size ? buildStrengths(sectionStats, scoreResult && scoreResult.bySection) : [];
  const patterns = buildPatterns(findings, sectionStats);
  const summaryMetrics = buildSummaryMetrics(scoreResult || {}, priorities, patterns, strengths);

  return { findings: [...findings], priorities, strengths, patterns, summaryMetrics };
}
