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
// Deliberately narrow. It carries what the public product already shows and no
// more: no certification level, no weight classes, no coverage, no derived
// findings, no facility profile, no framework or checklist version. Those
// answer forensic questions, and the audits columns exist for that. Putting
// them here would mean publishing internal state to the world by accident.
//
// Pure. No React, no Supabase, no clock of its own: publishedAt is passed in so
// one publish stamps one time everywhere.

import { SECTIONS } from '../auditItems.js';

/** The contract version. Bump when the shape changes in a way a reader must notice. */
export const PUBLISHED_RESULT_VERSION = 1;

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
 */
export function buildPublishedResult(input = {}) {
  const {
    prop = {}, graded = {}, auditType = 'full',
    criticalFailures = [], scoringBasis = null,
    auditedOn = null, publishedAt = null, summary = null,
  } = input;

  const score = publicScore(graded);
  const failures = (criticalFailures || []).map((f) => ({
    itemId: f.itemId || null,
    label: trimOrNull(f.label) || f.itemId || null,
    note: trimOrNull(f.note),
  }));
  const standardMet = meetsStandard(auditType, score.percent, failures.length);

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
  if (payload.formatVersion !== PUBLISHED_RESULT_VERSION) {
    bad(`formatVersion must be ${PUBLISHED_RESULT_VERSION}, got ${JSON.stringify(payload.formatVersion)}`);
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

  return errors;
}

/** True when the payload can be rendered exactly as published. */
export function isValidPublishedResult(payload) {
  return validatePublishedResult(payload).length === 0;
}
