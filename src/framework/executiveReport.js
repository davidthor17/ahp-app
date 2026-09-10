// Phase 6.6 — Executive Intelligence Report & Decision Layer.
//
// Phase 6.5 answered "what should the auditor look at." This module answers
// a different question for a different reader: a General Manager or owner
// who will never open a checklist. It does not derive a finding, compute a
// score, or invent a new ranking of raw findings — it takes what
// auditIntelligence.js already ranked and grouped, and reduces it further:
// a headline, a four-line summary, and capped top-N lists, instead of a
// findings list at all.
//
//   Raw Audit -> score() -> deriveFinding() -> auditIntelligence ->
//   (this module) -> a future AI narrative agent
//
// Pure, deterministic, side-effect free, independent of React. Two inputs,
// both already computed by the caller for other reasons:
//
//   scoreResult    score()'s own return value — overall, coverage, bySection
//   intelligence   analyzeAuditIntelligence()'s return value — findings,
//                  priorities, patterns, strengths, summaryMetrics
//   certification  certify()'s return value, optional — used only for the
//                  certification label a headline may cite; never recomputed
//
// No raw audit/profile/options are needed: everything this module ranks was
// already ranked once, by auditIntelligence.js. Re-deriving any of it here
// would be the second scoring engine the brief explicitly forbids.

import { SEVERITY } from './weights.js';

const SEVERITY_RANK = Object.freeze({
  [SEVERITY.ZERO_TOLERANCE]: 3, [SEVERITY.CRITICAL]: 2, [SEVERITY.MAJOR]: 1, [SEVERITY.MINOR]: 0,
});
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const TOP_PRIORITIES_MAX = 5;
const TOP_STRENGTHS_MAX = 3;
const SECTIONS_TO_WATCH_MAX = 5;

// ── headline ──────────────────────────────────────────────────────────────

const BAND_LABEL = Object.freeze({ strong: 'Strong', good: 'Good', mixed: 'Mixed', at_risk: 'At Risk' });

/**
 * Strong / Good / Mixed / At Risk / null (nothing graded yet).
 *
 * Thresholds mirror the certification tiers loosely (85/90/95 in
 * weights.js) without reusing them directly: certification is a pass/fail
 * gate against a specific level, and a band is a plain-language read of
 * the number itself, useful even for an audit type that carries no
 * certification (Desk Review) or a score that clears no level at all.
 */
export function performanceBand(overall) {
  if (overall === null || overall === undefined) return null;
  if (overall >= 90) return 'strong';
  if (overall >= 75) return 'good';
  if (overall >= 50) return 'mixed';
  return 'at_risk';
}

/**
 * One deterministic sentence. Severity always outranks the number: a
 * strong score never gets to claim "excellent" over an unresolved Zero
 * Tolerance escalation or a Critical finding, because leadership reading
 * only this line must not be able to miss either.
 */
export function buildHeadline({ overall, band, zeroToleranceCount, criticalCount, topPattern, hasFindings }) {
  if (band === null) return 'Audit not yet scored';
  const label = BAND_LABEL[band];

  if (zeroToleranceCount > 0) {
    return `${label} overall performance with a critical operational risk${zeroToleranceCount > 1 ? 's' : ''} recorded`;
  }
  if (criticalCount > 0) {
    return `${label} overall performance with critical issues requiring attention`;
  }
  if (topPattern) {
    if (topPattern.type === 'cross_section_dimension') {
      return `${label} overall performance, with recurring ${topPattern.dimension} inconsistency across the stay`;
    }
    if (topPattern.type === 'repeated_failure') {
      return `${label} overall performance, with recurring issues in ${topPattern.sectionLabel}`;
    }
    return `${label} overall performance, with inconsistent execution in ${topPattern.sectionLabel}`;
  }
  if (band === 'strong' && !hasFindings) {
    return 'Exceptional consistency across the guest experience';
  }
  return `${label} overall performance`;
}

// ── executive summary ────────────────────────────────────────────────────

/**
 * Four structured lines, never a paragraph. Any line whose underlying fact
 * does not exist is simply absent — an audit with strengths and no
 * findings has no "Primary concern" line, not an invented one.
 */
export function buildExecutiveSummary({ band, topPriority, topPattern, topStrength }) {
  const summary = { overallPerformance: band ? BAND_LABEL[band] : 'Not yet scored' };
  if (topPriority) {
    summary.primaryConcern = topPriority.title;
  }
  if (topPattern) {
    summary.operationalPattern = topPattern.explanation;
  }
  if (topStrength) {
    summary.positiveSignal = topStrength.title;
  }
  return summary;
}

// ── priorities, urgent / improvement split ──────────────────────────────

/**
 * Enriches the Phase 6.5 priority list — never re-ranks it. Rank order,
 * grouping and severity all come from intelligence.priorities exactly as
 * auditIntelligence.js produced them; this only attaches the extra
 * structured fields a UI or a future narrative agent needs (dimensions
 * touched, which patterns the same findings also belong to).
 */
function enrichPriorities(priorities, findingsById, sectionLabelOf, patterns) {
  return priorities.slice(0, TOP_PRIORITIES_MAX).map((p) => {
    const dims = new Set();
    for (const id of p.findingIds) {
      const f = findingsById.get(id);
      if (f && f.dimension) dims.add(f.dimension);
    }
    const relatedPatternIds = patterns
      .filter((pat) => pat.sectionIds.some((s) => p.sectionIds.includes(s)))
      .map((pat) => pat.id);
    return {
      rank: p.rank,
      severity: p.severity,
      type: p.type,
      title: p.title,
      reason: p.reason,
      findingCount: p.findingIds.length,
      sectionIds: p.sectionIds,
      affectedSections: p.sectionIds.map((id) => sectionLabelOf.get(id) || id),
      dimensions: [...dims],
      relatedPatternIds,
      findingIds: p.findingIds,
    };
  });
}

/**
 * Urgent: Zero Tolerance, Critical, or a repeated Major cluster — a
 * problem recorded more than once is not "isolated" any more, whatever its
 * severity. Everything else that still made the top-priority cut is an
 * improvement priority: worth planning for, not worth an alarm.
 */
function splitUrgency(priorities) {
  const urgent = [];
  const improvement = [];
  for (const p of priorities) {
    const isUrgent = p.severity === SEVERITY.ZERO_TOLERANCE
      || p.severity === SEVERITY.CRITICAL
      || (p.severity === SEVERITY.MAJOR && p.type === 'repeated');
    (isUrgent ? urgent : improvement).push(p);
  }
  return { urgent, improvement };
}

// ── patterns, translated ─────────────────────────────────────────────────

const PATTERN_ID = (p) => `${p.type}:${[...p.sectionIds].sort().join('+')}`;

/**
 * The same patterns auditIntelligence.js already detected, restated as one
 * executive-readable sentence per type. Never a causal claim — "a pattern
 * was detected," never "the cause is."
 */
export function explainPattern(p) {
  const count = p.findingIds.length;
  switch (p.type) {
    case 'repeated_failure':
      return `${count} related failure${count === 1 ? '' : 's'} recorded within ${p.sectionLabel}.`;
    case 'consistency_gap':
      return `Performance varies significantly within ${p.sectionLabel}, suggesting an inconsistent guest experience rather than a uniformly weak one.`;
    case 'cross_section_dimension':
      return `${cap(p.dimension)}-related findings appear across ${p.sectionIds.length} areas of the stay.`;
    default:
      return `Pattern detected in ${p.sectionLabel}.`;
  }
}

function buildPatterns(patterns, findingsById, sectionLabelOf) {
  return patterns.map((p) => {
    const first = findingsById.get(p.findingIds[0]);
    const dims = new Set();
    for (const id of p.findingIds) {
      const f = findingsById.get(id);
      if (f && f.dimension) dims.add(f.dimension);
    }
    const withLabel = {
      ...p,
      sectionLabel: sectionLabelOf.get(p.sectionIds[0]) || (first && first.sectionLabel) || p.sectionIds[0],
      dimension: p.type === 'cross_section_dimension' ? (first && first.dimension) || null : null,
      dimensions: [...dims],
    };
    return { id: PATTERN_ID(p), ...withLabel, explanation: explainPattern(withLabel) };
  });
}

// ── sections to watch ─────────────────────────────────────────────────────

/**
 * Not a re-sort of raw section scores. A section with one Critical finding
 * belongs here even sitting on a high weighted score, because a General
 * Manager needs to know where the risk is, not just where the average is
 * lowest. Severity first, then whether a pattern connects its findings,
 * then how many findings it carries, then the section's own score as the
 * final, quietest signal.
 */
function buildSectionsToWatch(findings, patterns, bySection) {
  const bySectionFindings = new Map();
  for (const f of findings) {
    if (!bySectionFindings.has(f.sectionId)) bySectionFindings.set(f.sectionId, []);
    bySectionFindings.get(f.sectionId).push(f);
  }
  const patternSections = new Set();
  for (const p of patterns) for (const id of p.sectionIds) patternSections.add(id);

  const rows = [];
  for (const [sectionId, group] of bySectionFindings) {
    const worst = group.reduce((w, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[w] ? f.severity : w), SEVERITY.MINOR);
    const worstFinding = group.reduce((w, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[w.severity] ? f : w), group[0]);
    rows.push({
      sectionId,
      sectionLabel: group[0].sectionLabel,
      worstSeverity: worst,
      findingCount: group.length,
      hasPattern: patternSections.has(sectionId),
      score: (bySection && bySection[sectionId] && bySection[sectionId].score) ?? null,
      itemId: worstFinding.itemId,
    });
  }

  rows.sort((a, b) =>
    SEVERITY_RANK[b.worstSeverity] - SEVERITY_RANK[a.worstSeverity]
    || Number(b.hasPattern) - Number(a.hasPattern)
    || b.findingCount - a.findingCount
    || (a.score ?? 0) - (b.score ?? 0)
    || a.sectionId.localeCompare(b.sectionId));

  return rows.slice(0, SECTIONS_TO_WATCH_MAX);
}

// ── key metrics ───────────────────────────────────────────────────────────

function buildKeyMetrics(scoreResult, certification, intelligence, urgentIssueCount) {
  const m = intelligence.summaryMetrics;
  const isDesk = certification && certification.auditType === 'desk';
  return {
    overallScore: scoreResult.overall,
    coverage: scoreResult.coverage,
    // Only ever a positive claim, and only when actually earned — an
    // audit that fell short of every level says nothing here rather than
    // naming a level it did not reach.
    certificationLabel: !isDesk && certification && certification.eligible ? certification.label : null,
    // The count of urgent priority items, not raw findings: a repeated
    // Critical cluster is one urgent issue to act on, not two, and this
    // must be the same number the Urgent Attention panel counts, or the
    // two would appear to contradict each other on the same screen.
    urgentIssueCount,
    priorityCount: m.priorityCount,
    patternCount: m.patternCount,
    strengthCount: m.strengthCount,
    // Contextual, never a failure count: shown so leadership knows how
    // much of the stay was actually observed, not folded into risk.
    notAssessedCount: m.notAssessedCount,
    notAvailableCount: m.notAvailableCount,
  };
}

// ── decision summary ──────────────────────────────────────────────────────

/**
 * One deterministic token for what to do next — the thing a future AI
 * narrative agent (or a UI call-to-action) can key off without having to
 * re-derive it from the arrays.
 */
function recommendedFocus({ overall, urgentCount, improvementCount, strengthCount }) {
  if (overall === null) return 'insufficient_data';
  if (urgentCount > 0) return 'address_urgent';
  if (improvementCount > 0) return 'improve';
  if (strengthCount > 0) return 'maintain';
  return 'none';
}

// ── entry point ───────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {object} input.scoreResult    score()'s return value
 * @param {object} input.intelligence   analyzeAuditIntelligence()'s return value
 * @param {object} [input.certification] certify()'s return value; optional —
 *   only the certification label is read, and it is simply omitted without one
 */
export function buildExecutiveReport({ scoreResult, intelligence, certification = null } = {}) {
  const findings = (intelligence && intelligence.findings) || [];
  const findingsById = new Map(findings.map((f) => [f.itemId, f]));
  // Findings are the only reliable source of a section's label (patterns
  // and priorities carry ids; strengths already carry their own). Built
  // once here rather than in each builder below.
  const sectionLabelOf = new Map(findings.map((f) => [f.sectionId, f.sectionLabel]));
  const rawPriorities = (intelligence && intelligence.priorities) || [];
  const rawPatterns = (intelligence && intelligence.patterns) || [];
  const rawStrengths = (intelligence && intelligence.strengths) || [];

  const patterns = buildPatterns(rawPatterns, findingsById, sectionLabelOf);
  const priorities = enrichPriorities(rawPriorities, findingsById, sectionLabelOf, patterns);
  const { urgent: urgentIssues, improvement: improvementAreas } = splitUrgency(priorities);
  const strengths = rawStrengths.slice(0, TOP_STRENGTHS_MAX);

  const overall = scoreResult ? scoreResult.overall : null;
  const band = performanceBand(overall);
  const summaryMetrics = (intelligence && intelligence.summaryMetrics) || {
    zeroToleranceFindings: 0, criticalFindings: 0,
  };

  const topPriority = priorities[0] || null;
  const topPattern = patterns[0] || null;
  const topStrength = strengths[0] || null;

  const headline = buildHeadline({
    overall, band,
    zeroToleranceCount: summaryMetrics.zeroToleranceFindings || 0,
    criticalCount: summaryMetrics.criticalFindings || 0,
    topPattern,
    hasFindings: findings.length > 0,
  });

  const executiveSummary = buildExecutiveSummary({ band, topPriority, topPattern, topStrength });

  const sectionsToWatch = buildSectionsToWatch(findings, patterns, scoreResult && scoreResult.bySection);

  const keyMetrics = buildKeyMetrics(scoreResult || { overall: null, coverage: null }, certification, {
    summaryMetrics: {
      criticalFindings: 0, zeroToleranceFindings: 0, priorityCount: 0, patternCount: 0, strengthCount: 0,
      notAssessedCount: 0, notAvailableCount: 0, ...summaryMetrics,
    },
  }, urgentIssues.length);

  return {
    headline,
    executiveSummary,
    performance: { band, overall, coverage: scoreResult ? scoreResult.coverage : null },

    priorities,
    urgentIssues,
    improvementAreas,

    patterns,
    strengths,

    keyMetrics,
    sectionsToWatch,

    decisionSummary: {
      recommendedFocus: recommendedFocus({
        overall, urgentCount: urgentIssues.length, improvementCount: improvementAreas.length, strengthCount: strengths.length,
      }),
      urgentCount: urgentIssues.length,
      improvementCount: improvementAreas.length,
      topPriorityTitle: topPriority ? topPriority.title : null,
      topPatternId: topPattern ? topPattern.id : null,
      topStrengthSection: topStrength ? topStrength.sectionId : null,
    },
  };
}
