// The frozen public representation of a published audit.
//
// Until now the public report was a live query. It read the property row as it
// stands today, recomputed the score in the browser from audit_items rows that
// stay writable after publication, and held its own opinion about which
// sections exist. A report was therefore a view of the present, not a record of
// what was published.
//
// This builds the document instead. Everything the public page renders is
// computed once, here, at the moment of publication, and written to
// audits.published_result. The reader then renders that and nothing else.
//
// Deliberately narrow. Version 1 carried what the public product already showed
// and no more. Version 2 adds one optional block, `intelligence`, and adds it
// the same way: an explicit allow-list of already-computed judgments, restated
// in public words. Still no certification level, no weight classes, no
// coverage, no raw findings, no auditor notes, no evidence, no facility
// profile, no framework or checklist version, no internal severity ladder.
// Those answer forensic questions, and the audits columns exist for that.
// Putting them here would mean publishing internal state to the world by
// accident.
//
// Pure. No React, no Supabase, no clock of its own: publishedAt is passed in so
// one publish stamps one time everywhere.

import { SECTIONS } from '../auditItems.js';

/** The contract version. Bump when the shape changes in a way a reader must notice. */
export const PUBLISHED_RESULT_VERSION = 2;

/**
 * Versions this repository can still validate.
 *
 * 1 is every report published before Phase 6.8 and keeps its original meaning
 * forever: the fields above and nothing else. 2 is 1 plus an optional
 * `intelligence` block. Nothing rewrites a version 1 document, so a reader that
 * knows both has to keep knowing both.
 */
export const SUPPORTED_PUBLISHED_RESULT_VERSIONS = Object.freeze([1, 2]);

/** The legacy public threshold. Unchanged, and deliberately still the legacy score. */
export const PASS_THRESHOLD = 85;

/** Audit types that can carry the Specula Mark. Full only, per the locked hierarchy. */
export const MARK_AUDIT_TYPES = Object.freeze(['full']);

// Worst wins when an item was graded across several shifts, which is how both
// the console and the current public report already read a multi-shift audit.
const STATUS_RANK = Object.freeze({ met: 0, na: 1, partial: 2, missed: 3 });
const GRADED = Object.freeze(['met', 'partial', 'missed']);

const SECTION_LABEL = new Map(SECTIONS.map((s) => [s.id, s.label]));
const SECTION_POSITION = new Map(SECTIONS.map((s, i) => [s.id, i]));
const ITEM_SECTION = new Map();
for (const section of SECTIONS) {
  for (const item of section.items) ITEM_SECTION.set(item.id, section.id);
}

/**
 * The worst status recorded against each item, across every shift.
 * @param {object} graded { itemId: { shiftId: { status } } }
 * @returns {Map<string, string>} itemId -> status
 */
export function worstStatusByItem(graded = {}) {
  const out = new Map();
  for (const [itemId, byShift] of Object.entries(graded || {})) {
    for (const entry of Object.values(byShift || {})) {
      if (!entry || !entry.status) continue;
      const current = out.get(itemId);
      if (current === undefined || (STATUS_RANK[entry.status] ?? 0) > (STATUS_RANK[current] ?? 0)) {
        out.set(itemId, entry.status);
      }
    }
  }
  return out;
}

/**
 * Per-section counts, in checklist order, carrying each label with it.
 *
 * The label travels so that renaming a section later cannot rewrite a report
 * published before the rename, and so the public page stops needing its own map
 * of what sections exist. That map is how `facilities` and `safety` came to be
 * counted in the total but missing from the breakdown.
 *
 * A section appears only if the audit recorded something in it, which is what
 * the public report has always done.
 */
export function sectionBreakdown(graded = {}) {
  const worst = worstStatusByItem(graded);
  const bySection = new Map();

  for (const [itemId, status] of worst) {
    const sectionId = ITEM_SECTION.get(itemId);
    // An item the catalogue no longer knows still belongs to the audit it was
    // recorded in, so it keeps its own id as a section rather than vanishing.
    const id = sectionId || 'unknown';
    if (!bySection.has(id)) {
      bySection.set(id, { id, label: SECTION_LABEL.get(id) || id, total: 0, met: 0, partial: 0, missed: 0, na: 0 });
    }
    const row = bySection.get(id);
    row.total += 1;
    if (row[status] !== undefined) row[status] += 1;
  }

  return [...bySection.values()].sort(
    (a, b) => (SECTION_POSITION.get(a.id) ?? 999) - (SECTION_POSITION.get(b.id) ?? 999),
  );
}

/**
 * The public score: met over everything graded, unweighted.
 *
 * This is the legacy score and stays the legacy score. The framework result is
 * a different number with different meaning, and swapping one for the other on
 * a page the public has already seen would silently restate a published claim.
 */
export function publicScore(graded = {}) {
  const statuses = [...worstStatusByItem(graded).values()];
  const met = statuses.filter((s) => s === 'met').length;
  const itemsGraded = statuses.filter((s) => GRADED.includes(s)).length;
  return {
    percent: itemsGraded ? Math.round((met / itemsGraded) * 100) : null,
    itemsMet: met,
    itemsGraded,
  };
}

/** Does this audit meet the public standard? The decision, stored so the threshold can move. */
export function meetsStandard(auditType, percent, criticalFailureCount) {
  return auditType !== 'desk'
    && criticalFailureCount === 0
    && percent !== null
    && percent >= PASS_THRESHOLD;
}

/**
 * May this audit carry the Specula Mark?
 *
 * Full Audit only. A Spot Audit that meets the standard is "Reviewed by
 * Specula" and carries no Mark; a Desk Review carries no status at all. The
 * public report rendered the Mark graphic in silver for a passing Spot Audit,
 * which is precisely the implication the hierarchy forbids.
 */
export function marksAudit(auditType, standardMet) {
  return MARK_AUDIT_TYPES.includes(auditType) && standardMet === true;
}

/**
 * How this audit can describe the property state it was measured against.
 * Mirrors SNAPSHOT_STATUS without importing it, because the payload speaks the
 * public vocabulary: a reader outside this repository must not have to know
 * what "legacy-unfrozen" means.
 */
export function basisFor(scoringBasis) {
  if (!scoringBasis) return { state: 'legacy', recordedOn: null };
  if (scoringBasis.frozen === true) {
    return { state: 'frozen', recordedOn: scoringBasis.lockedAt || null };
  }
  // A basis was recorded and cannot be read. Different from never having one,
  // and the reader says so differently.
  if (scoringBasis.status === 'unusable') return { state: 'incomplete', recordedOn: null };
  return { state: 'legacy', recordedOn: null };
}

const trimOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// ── The published intelligence block (version 2) ────────────────────────────
//
// Phase 6.8. A curated, client-facing reduction of what auditIntelligence.js
// and executiveReport.js already computed. It does not analyse anything: every
// judgment here was made upstream, and this only chooses which of those
// judgments the public may see and restates them in public words.
//
// Built field by field, deliberately. Never by spreading an upstream object and
// removing what should not be there: a spread publishes whatever the intelligence
// layer grows next, and the next field it grows may be an auditor's note. An
// allow-list stays correct as the layer above it changes; a deny-list does not.
//
// Three things upstream carries that must never cross this line:
//
//   auditor notes     priorities[].reason interpolates finding.note verbatim,
//                     which is internal prose written for Specula, not for the
//                     client. Every reason below is rebuilt from counts,
//                     statuses and section labels instead.
//   the severity ladder
//                     zero_tolerance / critical / major / minor is scoring
//                     machinery. The public sees three levels of priority
//                     instead, and an escalated finding reads as high priority
//                     rather than announcing that an escalation tier exists.
//
//                     Deliberately not "critical". The report already reserves
//                     that word for a failure the auditor flagged by hand, under
//                     Key Findings, and a framework severity is a different
//                     judgment about a different thing. Publishing both under
//                     one word would let a report say "no critical findings
//                     recorded" directly above a list of critical findings.
//   pattern type ids  repeated_failure and friends are internal identifiers.
//                     The public vocabulary is fixed below and the reader
//                     renders from it, so renaming one internally cannot
//                     rewrite a report published before the rename.

/**
 * Internal severity to public severity. Mirrors weights.js SEVERITY without
 * importing it, exactly as basisFor mirrors SNAPSHOT_STATUS: a reader outside
 * this repository must never have to know what zero_tolerance means. A test
 * asserts every internal severity has a mapping here.
 */
export const PUBLIC_SEVERITY = Object.freeze({
  zero_tolerance: 'high',
  critical: 'high',
  major: 'moderate',
  minor: 'low',
});

/** Internal pattern type to the public vocabulary the reader renders. */
export const PUBLIC_PATTERN_TYPE = Object.freeze({
  repeated_failure: 'recurring',
  consistency_gap: 'inconsistent',
  cross_section_dimension: 'cross_area',
});

export const PUBLIC_SEVERITIES = Object.freeze(['high', 'moderate', 'low']);
export const PUBLIC_PATTERN_TYPES = Object.freeze(['recurring', 'inconsistent', 'cross_area']);

/** How much of each list may be published. The lists are already capped upstream; this is the contract's own promise. */
export const INTELLIGENCE_LIMITS = Object.freeze({
  priorities: 5, patterns: 5, strengths: 3, sectionsToWatch: 5,
});

const SEVERITY_WORD = Object.freeze({ high: 'High', moderate: 'Moderate', low: 'Low' });
const STATUS_WORD = Object.freeze({ missed: 'Missed', partial: 'Partial' });
const BAND_WORD = Object.freeze({
  strong: 'Strong', good: 'Good', mixed: 'Mixed', attention: 'Requires attention',
});

const publicSeverity = (s) => PUBLIC_SEVERITY[s] || 'low';

/**
 * The band the published score falls in.
 *
 * Deliberately computed from the payload's own score rather than carried over
 * from executiveReport, whose band reads the framework's weighted result. Those
 * are two different numbers with two different meanings, and the public report
 * shows the unweighted one in letters two inches tall. A headline banded on the
 * other one would sit directly above a figure that disagrees with it.
 *
 * Same thresholds the reader already applies, so the wording the page derives
 * for a version 1 report and the wording published with a version 2 one cannot
 * describe the same score differently.
 */
export function publicBand(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent >= 90) return 'strong';
  if (percent >= 75) return 'good';
  if (percent >= 50) return 'mixed';
  return 'attention';
}

/**
 * One deterministic sentence, in public words.
 *
 * Never "critical": the report reserves that for an auditor-flagged failure,
 * which is stated in its own block and must stay the loudest thing on the page.
 * This line knows something that block does not, which is why it is worth
 * publishing at all: how many priorities the audit produced and whether they
 * connect into a pattern.
 */
export function publicHeadline({ percent, highCount = 0, hasPattern = false, hasPriorities = false }) {
  const band = publicBand(percent);
  if (band === null) return 'This assessment has not yet been scored.';
  // The lowest band reads as a verb rather than an adjective. "Requires
  // attention overall performance" is what putting every band in the same
  // sentence frame produces, and it is not English.
  const lead = band === 'attention'
    ? 'Overall performance requires attention'
    : `${BAND_WORD[band]} overall performance`;
  if (highCount > 0) {
    return `${lead}, with ${highCount} high priority ${highCount === 1 ? 'issue' : 'issues'} to address.`;
  }
  if (hasPattern) return `${lead}, with a recurring pattern across the stay.`;
  if (band === 'strong' && !hasPriorities) return 'A consistently strong guest experience across this stay.';
  return `${lead}.`;
}

const asList = (v) => (Array.isArray(v) ? v : []);

/**
 * A priority restated for the client.
 *
 * Same rank, same grouping, same severity ordering: this re-ranks nothing. Only
 * the two strings change, because upstream builds them out of item ids and the
 * auditor's own note.
 */
function publicPriority(p, findingById) {
  const severity = publicSeverity(p.severity);
  const word = SEVERITY_WORD[severity];
  const sectionLabel = asList(p.affectedSections)[0] || asList(p.sectionIds)[0] || 'this audit';
  const count = Number.isFinite(p.findingCount) ? p.findingCount : asList(p.findingIds).length;
  const finding = findingById.get(asList(p.findingIds)[0]) || null;

  let title;
  let reason;
  if (count > 1) {
    title = `${word} priority: ${count} items in ${sectionLabel}`;
    reason = `${count} items in ${sectionLabel} were not fully met. Ranked ${severity} priority.`;
  } else if (finding && finding.label) {
    title = `${word} priority: ${finding.label}`;
    const status = STATUS_WORD[finding.status] || finding.status || 'not fully met';
    reason = `Recorded in ${sectionLabel} as ${status}. Ranked ${severity} priority.`;
  } else {
    // The finding behind this priority is not in the findings array. The
    // priority is still real, so it is published without the detail rather than
    // dropped or filled in with a guess.
    title = `${word} priority in ${sectionLabel}`;
    reason = `Recorded in ${sectionLabel}. Ranked ${severity} priority.`;
  }

  return {
    rank: p.rank,
    severity,
    title,
    reason,
    findingCount: count,
    sectionIds: [...asList(p.sectionIds)],
    affectedSections: [...asList(p.affectedSections)],
  };
}

/**
 * Build the curated intelligence block, or null when there is nothing to build
 * it from.
 *
 * @param {object} input
 * @param {object} input.intelligence     analyzeAuditIntelligence()'s return value
 * @param {object} input.executiveReport  buildExecutiveReport()'s return value
 * @param {object} input.score            the payload's own published score, so
 *   the headline and the figure the page prints cannot disagree
 */
export function buildPublishedIntelligence(input = {}) {
  const { intelligence = null, executiveReport = null, score = null } = input;
  if (!intelligence || !executiveReport) return null;

  const findingById = new Map(asList(intelligence.findings).map((f) => [f.itemId, f]));

  const priorities = asList(executiveReport.priorities)
    .slice(0, INTELLIGENCE_LIMITS.priorities)
    .map((p) => publicPriority(p, findingById));

  const patterns = asList(executiveReport.patterns)
    .slice(0, INTELLIGENCE_LIMITS.patterns)
    .map((p) => ({
      type: PUBLIC_PATTERN_TYPE[p.type] || 'recurring',
      severity: publicSeverity(p.severity),
      // Already written for a reader who will never open a checklist, and
      // built from counts and section labels rather than from any note.
      explanation: p.explanation,
      sectionIds: [...asList(p.sectionIds)],
    }));

  const strengths = asList(executiveReport.strengths)
    .slice(0, INTELLIGENCE_LIMITS.strengths)
    .map((s) => ({
      sectionId: s.sectionId,
      title: s.title,
      reason: s.reason,
      assessedCount: s.assessedCount,
    }));

  const sectionsToWatch = asList(executiveReport.sectionsToWatch)
    .slice(0, INTELLIGENCE_LIMITS.sectionsToWatch)
    .map((s) => ({
      sectionId: s.sectionId,
      sectionLabel: s.sectionLabel,
      severity: publicSeverity(s.worstSeverity),
      findingCount: s.findingCount,
    }));

  const km = executiveReport.keyMetrics || {};
  // Two deliberate absences.
  //
  // coverage, because how much of a property was reached is a fact about the
  // assessment rather than about the hotel, and publishing it without the
  // context that surrounds it internally would invite the wrong reading.
  //
  // overallScore, because the framework's weighted result is not the number
  // this document publishes. `score` above is the unweighted legacy figure the
  // public report has always shown, and this file has said since version 1 that
  // swapping one for the other would silently restate a published claim.
  // Carrying both would put two different percentages on one page.
  const keyMetrics = {
    urgentIssueCount: km.urgentIssueCount || 0,
    priorityCount: km.priorityCount || 0,
    patternCount: km.patternCount || 0,
    strengthCount: km.strengthCount || 0,
    notAssessedCount: km.notAssessedCount || 0,
    notAvailableCount: km.notAvailableCount || 0,
  };

  const percent = score && Number.isFinite(score.percent) ? score.percent : null;
  const band = publicBand(percent);
  const highCount = priorities.filter((p) => p.severity === 'high').length;

  // Each line is present only when the fact behind it is. An audit with no
  // findings has no primary concern, and inventing one would be the one thing
  // this whole layer exists to prevent. primaryConcern is taken from the
  // rewritten priority above, never from the upstream title, which carries an
  // item id and the internal severity name.
  const summary = { overallPerformance: band ? BAND_WORD[band] : 'Not yet scored' };
  if (priorities.length) summary.primaryConcern = priorities[0].title;
  if (patterns.length) summary.operationalPattern = patterns[0].explanation;
  if (strengths.length) summary.positiveSignal = strengths[0].title;

  return {
    headline: publicHeadline({
      percent, highCount, hasPattern: patterns.length > 0, hasPriorities: priorities.length > 0,
    }),
    summary,
    keyMetrics,
    priorities,
    urgentIssueCount: asList(executiveReport.urgentIssues).length,
    improvementCount: asList(executiveReport.improvementAreas).length,
    patterns,
    strengths,
    sectionsToWatch,
  };
}

/**
 * Build the version 1 payload.
 *
 * @param {object} input
 * @param {object} input.prop         the property as it stands at publication
 * @param {object} input.graded       { itemId: { shiftId: { status } } }
 * @param {string} input.auditType    full | spot | desk
 * @param {Array}  input.criticalFailures  from the console, already labelled
 * @param {object} input.scoringBasis the resolved basis for this audit
 * @param {string} input.auditedOn    audits.date, the date of the stay
 * @param {string} input.publishedAt  one ISO timestamp for this publication
 * @param {object} [input.intelligence]    analyzeAuditIntelligence()'s return value
 * @param {object} [input.executiveReport] buildExecutiveReport()'s return value
 *
 * The last two are optional. Without both, the payload simply carries no
 * `intelligence` key: a version 2 document that says nothing rather than a
 * version 2 document that says something thin.
 */
export function buildPublishedResult(input = {}) {
  const {
    prop = {}, graded = {}, auditType = 'full',
    criticalFailures = [], scoringBasis = null,
    auditedOn = null, publishedAt = null, summary = null,
    intelligence = null, executiveReport = null,
  } = input;

  const score = publicScore(graded);
  const failures = (criticalFailures || []).map((f) => ({
    itemId: f.itemId || null,
    label: trimOrNull(f.label) || f.itemId || null,
    note: trimOrNull(f.note),
  }));
  const standardMet = meetsStandard(auditType, score.percent, failures.length);
  const published = buildPublishedIntelligence({ intelligence, executiveReport, score });

  return {
    formatVersion: PUBLISHED_RESULT_VERSION,
    publishedAt: publishedAt || null,
    auditedOn: auditedOn || null,
    auditType,
    property: {
      name: trimOrNull(prop.name),
      city: trimOrNull(prop.city),
      country: trimOrNull(prop.country),
      category: trimOrNull(prop.category),
    },
    score,
    standardMet,
    // The auditor's prose, frozen with everything else. It was missing from the
    // first draft of this contract, which would have left the report reading it
    // live from the audits row: the one field still able to change a published
    // page after publication.
    summary: trimOrNull(summary),
    sections: sectionBreakdown(graded),
    criticalFailures: failures,
    basis: basisFor(scoringBasis),
    // Absent rather than null when there is none: a reader tests for the key,
    // and an explicit null would make "no intelligence was built" and "the
    // intelligence is empty" the same shape.
    ...(published ? { intelligence: published } : {}),
  };
}

// ── Validation ──────────────────────────────────────────────────────────────
//
// The writer refuses to publish a payload that would not render, so a broken
// payload never reaches the database. The reader validates independently, in
// its own repository, because a reader that trusts what it is given is exactly
// how a malformed payload turns into a silently wrong public claim. The two
// implementations are deliberately separate; they are checked against each
// other by tests, not by a shared import across repositories.

const AUDIT_TYPES = ['full', 'spot', 'desk'];
const BASIS_STATES = ['frozen', 'legacy', 'incomplete'];

/**
 * @returns {string[]} every problem found, empty when the payload is renderable
 */
export function validatePublishedResult(payload) {
  const errors = [];
  const bad = (m) => errors.push(m);

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['payload is not an object'];
  }
  if (!SUPPORTED_PUBLISHED_RESULT_VERSIONS.includes(payload.formatVersion)) {
    bad(`formatVersion must be one of ${SUPPORTED_PUBLISHED_RESULT_VERSIONS.join(', ')}, got ${JSON.stringify(payload.formatVersion)}`);
  }
  if (!AUDIT_TYPES.includes(payload.auditType)) {
    bad(`auditType must be one of ${AUDIT_TYPES.join(', ')}`);
  }
  if (typeof payload.publishedAt !== 'string' || !payload.publishedAt) {
    bad('publishedAt must be a non-empty string');
  }
  if (typeof payload.standardMet !== 'boolean') bad('standardMet must be a boolean');

  const p = payload.property;
  if (!p || typeof p !== 'object') bad('property is missing');
  else if (!p.name) bad('property.name is required');

  const s = payload.score;
  if (!s || typeof s !== 'object') bad('score is missing');
  else {
    if (s.percent !== null && !Number.isFinite(s.percent)) bad('score.percent must be a number or null');
    if (!Number.isFinite(s.itemsMet)) bad('score.itemsMet must be a number');
    if (!Number.isFinite(s.itemsGraded)) bad('score.itemsGraded must be a number');
  }

  if (!Array.isArray(payload.sections)) bad('sections must be an array');
  else {
    payload.sections.forEach((sec, i) => {
      if (!sec || typeof sec !== 'object') { bad(`sections[${i}] is not an object`); return; }
      if (!sec.id) bad(`sections[${i}].id is required`);
      if (!sec.label) bad(`sections[${i}].label is required`);
      if (!Number.isFinite(sec.total)) bad(`sections[${i}].total must be a number`);
      for (const k of ['met', 'partial', 'missed', 'na']) {
        if (!Number.isFinite(sec[k])) bad(`sections[${i}].${k} must be a number`);
      }
    });
  }

  if (!Array.isArray(payload.criticalFailures)) bad('criticalFailures must be an array');
  if (payload.summary !== null && typeof payload.summary !== 'string') bad('summary must be a string or null');

  const b = payload.basis;
  if (!b || typeof b !== 'object') bad('basis is missing');
  else if (!BASIS_STATES.includes(b.state)) {
    bad(`basis.state must be one of ${BASIS_STATES.join(', ')}`);
  } else if (b.state === 'frozen' && !b.recordedOn) {
    bad('basis.recordedOn is required when the basis is frozen');
  }

  if ('intelligence' in payload) {
    if (payload.formatVersion === 1) {
      // A version 1 document is the fields above and nothing else. Something
      // has assembled a hybrid, and a reader that only knows version 1 would
      // render it while silently ignoring a block it cannot see.
      bad('formatVersion 1 carries no intelligence block');
    }
    for (const e of validatePublishedIntelligence(payload.intelligence)) bad(`intelligence.${e}`);
  }

  return errors;
}

/**
 * @returns {string[]} every problem found in an intelligence block
 *
 * Separate from the payload check because the two fail differently downstream.
 * The base fields are load-bearing and a reader must refuse to render without
 * them; this block is an enhancement, and a reader that cannot trust it should
 * fall back to the base report rather than take the whole page down. The writer
 * still treats any problem here as fatal, because it has the option of not
 * publishing at all.
 */
export function validatePublishedIntelligence(intel) {
  const errors = [];
  const bad = (m) => errors.push(m);

  if (!intel || typeof intel !== 'object' || Array.isArray(intel)) return ['is not an object'];
  if (typeof intel.headline !== 'string' || !intel.headline) bad('headline must be a non-empty string');

  if (!intel.summary || typeof intel.summary !== 'object') bad('summary is missing');
  else if (typeof intel.summary.overallPerformance !== 'string') bad('summary.overallPerformance must be a string');

  const km = intel.keyMetrics;
  if (!km || typeof km !== 'object') bad('keyMetrics is missing');
  else {
    for (const k of ['urgentIssueCount', 'priorityCount', 'patternCount', 'strengthCount', 'notAssessedCount', 'notAvailableCount']) {
      if (!Number.isFinite(km[k])) bad(`keyMetrics.${k} must be a number`);
    }
    if ('coverage' in km) bad('keyMetrics.coverage is not published');
    if ('overallScore' in km) bad('keyMetrics.overallScore is not published');
  }

  const list = (key, limit, check) => {
    if (!Array.isArray(intel[key])) { bad(`${key} must be an array`); return; }
    if (intel[key].length > limit) bad(`${key} must hold at most ${limit} entries`);
    intel[key].forEach((row, i) => {
      if (!row || typeof row !== 'object') { bad(`${key}[${i}] is not an object`); return; }
      for (const e of check(row)) bad(`${key}[${i}].${e}`);
    });
  };

  list('priorities', INTELLIGENCE_LIMITS.priorities, (p) => {
    const e = [];
    if (!Number.isFinite(p.rank)) e.push('rank must be a number');
    if (!PUBLIC_SEVERITIES.includes(p.severity)) e.push(`severity must be one of ${PUBLIC_SEVERITIES.join(', ')}`);
    if (!p.title) e.push('title is required');
    if (!p.reason) e.push('reason is required');
    if (!Number.isFinite(p.findingCount)) e.push('findingCount must be a number');
    if (!Array.isArray(p.sectionIds)) e.push('sectionIds must be an array');
    if (!Array.isArray(p.affectedSections)) e.push('affectedSections must be an array');
    return e;
  });

  list('patterns', INTELLIGENCE_LIMITS.patterns, (p) => {
    const e = [];
    if (!PUBLIC_PATTERN_TYPES.includes(p.type)) e.push(`type must be one of ${PUBLIC_PATTERN_TYPES.join(', ')}`);
    if (!PUBLIC_SEVERITIES.includes(p.severity)) e.push(`severity must be one of ${PUBLIC_SEVERITIES.join(', ')}`);
    if (!p.explanation) e.push('explanation is required');
    if (!Array.isArray(p.sectionIds)) e.push('sectionIds must be an array');
    return e;
  });

  list('strengths', INTELLIGENCE_LIMITS.strengths, (s) => {
    const e = [];
    if (!s.sectionId) e.push('sectionId is required');
    if (!s.title) e.push('title is required');
    if (!s.reason) e.push('reason is required');
    if (!Number.isFinite(s.assessedCount)) e.push('assessedCount must be a number');
    if ('score' in s) e.push('score is not published');
    return e;
  });

  list('sectionsToWatch', INTELLIGENCE_LIMITS.sectionsToWatch, (s) => {
    const e = [];
    if (!s.sectionId) e.push('sectionId is required');
    if (!s.sectionLabel) e.push('sectionLabel is required');
    if (!PUBLIC_SEVERITIES.includes(s.severity)) e.push(`severity must be one of ${PUBLIC_SEVERITIES.join(', ')}`);
    if (!Number.isFinite(s.findingCount)) e.push('findingCount must be a number');
    return e;
  });

  if (!Number.isFinite(intel.urgentIssueCount)) bad('urgentIssueCount must be a number');
  if (!Number.isFinite(intel.improvementCount)) bad('improvementCount must be a number');

  return errors;
}

/** True when the payload can be rendered exactly as published. */
export function isValidPublishedResult(payload) {
  return validatePublishedResult(payload).length === 0;
}
