/**
 * What state an item has reached, and how that reads to an auditor.
 *
 * Phase 6.2. The distinction this exists to protect is the one the whole
 * methodology rests on, and it was already in the data model without being
 * visible anywhere:
 *
 *   the auditor should have checked breakfast and did not      MISSED
 *   the auditor chose not to eat breakfast                     NOT ASSESSED
 *   the hotel does not serve breakfast                         NOT AVAILABLE
 *   the auditor ate breakfast and it was poor                  ASSESSED, missed
 *   the auditor ate breakfast and it was excellent             ASSESSED, met
 *
 * The middle three are all status 'na' in the database and are told apart by
 * na_reason, which has existed since Phase 4B:
 *
 *   not_present   the facility does not exist        structural, leaves the audit
 *   not_offered   the service is not provided        structural, leaves the audit
 *   not_observed  available, not seen on this stay   stays in scope, unassessed
 *
 * NOT ASSESSED IS not_observed. It is not a new state and it needs no new
 * column: the vocabulary was right, it simply had no name in the interface and
 * no place in the progress counts.
 *
 * ── what this does NOT change ──────────────────────────────────────────────
 *
 * Nothing about scoring, because the scoring is already correct. weightedScore
 * skips any entry that is not graded, and GRADED_STATUSES is met, partial and
 * missed only. A Not Assessed item is therefore already absent from the score
 * numerator and denominator both: it cannot lower a property's score and never
 * could.
 *
 * It does stay in the COVERAGE denominator, and that is deliberate and
 * load-bearing rather than an oversight. Coverage is a certification gate at
 * 80, 90 and 95 per cent. If Not Assessed left that denominator too, an
 * auditor could mark ninety per cent of the checklist Not Assessed and certify
 * a hotel Specula Certified on the strength of the remaining ten. Coverage is
 * the measure of how much of the audit was actually performed, and an item
 * nobody experienced was, accurately, not performed.
 *
 * So: a property is never marked down for an unvisited spa, and an audit that
 * skipped the spa is never described as complete. Both are true at once, and
 * they are different questions.
 */

import { NA_REASON, STRUCTURAL_NA_REASONS, GRADED_STATUSES } from './weights.js';

/** The auditor-facing state of one evaluated item. */
export const ITEM_STATE = Object.freeze({
  ASSESSED: 'assessed',
  MISSED: 'missed',
  NOT_ASSESSED: 'not_assessed',
  NOT_AVAILABLE: 'not_available',
  PENDING: 'pending',
});

/** Not Assessed is not_observed. Named here so the alias is stated once. */
export const NOT_ASSESSED_REASON = NA_REASON.NOT_OBSERVED;

export const STATE_LABEL = Object.freeze({
  [ITEM_STATE.ASSESSED]: 'assessed',
  [ITEM_STATE.MISSED]: 'missed',
  [ITEM_STATE.NOT_ASSESSED]: 'not assessed',
  [ITEM_STATE.NOT_AVAILABLE]: 'not available',
  [ITEM_STATE.PENDING]: 'to do',
});

/**
 * The state of one item, from the entry the console holds for it.
 *
 * `missed` is separated out of `assessed` because the auditor thinks of them
 * differently even though both are graded determinations: one is a judgement
 * about the hotel, the other reads as a gap in the audit until you look.
 *
 * An N/A with no reason is read as Not Assessed, matching LEGACY_NA_REASON.
 * That is the conservative reading: it keeps the item in coverage rather than
 * quietly erasing it from an audit recorded before reasons existed.
 */
export function itemState(entry) {
  if (!entry || !entry.status) return ITEM_STATE.PENDING;
  if (entry.status === 'missed') return ITEM_STATE.MISSED;
  if (GRADED_STATUSES.includes(entry.status)) return ITEM_STATE.ASSESSED;
  if (entry.status === 'na') {
    const reason = entry.naReason || NOT_ASSESSED_REASON;
    return STRUCTURAL_NA_REASONS.includes(reason)
      ? ITEM_STATE.NOT_AVAILABLE
      : ITEM_STATE.NOT_ASSESSED;
  }
  return ITEM_STATE.PENDING;
}

/**
 * The worst state across the shifts an item was evaluated in.
 *
 * Same rule the scoring engine uses: when one item carries different answers
 * in different shifts, the least favourable one stands. Pending loses to
 * everything, because an item assessed in one shift has been assessed.
 */
const STATE_RANK = Object.freeze({
  [ITEM_STATE.PENDING]: -1,
  [ITEM_STATE.NOT_AVAILABLE]: 0,
  [ITEM_STATE.NOT_ASSESSED]: 1,
  [ITEM_STATE.ASSESSED]: 2,
  [ITEM_STATE.MISSED]: 3,
});

export function itemStateAcrossShifts(byShift = {}, shiftIds = null) {
  const ids = shiftIds || Object.keys(byShift || {});
  let worst = ITEM_STATE.PENDING;
  for (const id of ids) {
    const state = itemState((byShift || {})[id]);
    if (state === ITEM_STATE.PENDING) continue;
    if (worst === ITEM_STATE.PENDING || STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  }
  return worst;
}

/**
 * Has this item reached a deliberate final state?
 *
 * The finish gate. An auditor must never be forced to invent an assessment
 * because they did not use an optional hotel service, so Not Assessed and Not
 * Available both count as finished. Only Pending does not: nobody has said
 * anything about it yet.
 */
export const isFinalState = (state) => state !== ITEM_STATE.PENDING;

export const isFinal = (entryOrShifts, shiftIds = null) =>
  isFinalState(shiftIds || typeof entryOrShifts === 'object'
    ? itemStateAcrossShifts(entryOrShifts, shiftIds)
    : itemState(entryOrShifts));

/** Count a set of items by state. Every item lands in exactly one bucket. */
export function tallyStates(states = []) {
  const out = {
    assessed: 0, missed: 0, notAssessed: 0, notAvailable: 0, pending: 0, total: states.length,
  };
  for (const s of states) {
    if (s === ITEM_STATE.ASSESSED) out.assessed += 1;
    else if (s === ITEM_STATE.MISSED) out.missed += 1;
    else if (s === ITEM_STATE.NOT_ASSESSED) out.notAssessed += 1;
    else if (s === ITEM_STATE.NOT_AVAILABLE) out.notAvailable += 1;
    else out.pending += 1;
  }
  out.finished = out.total - out.pending;
  return out;
}

/**
 * The progress line.
 *
 * Reads "42 assessed · 3 missed · 10 not assessed", and drops any part that is
 * zero so a clean section says "8 assessed" rather than carrying three noughts.
 * Missed is included in the assessed count nowhere: they are different things
 * to an auditor scanning a list for what still needs doing.
 */
export function progressLabel(tally) {
  const parts = [];
  if (tally.assessed) parts.push(`${tally.assessed} assessed`);
  if (tally.missed) parts.push(`${tally.missed} missed`);
  if (tally.notAssessed) parts.push(`${tally.notAssessed} not assessed`);
  if (tally.notAvailable) parts.push(`${tally.notAvailable} not available`);
  if (tally.pending) parts.push(`${tally.pending} to do`);
  return parts.length ? parts.join(' · ') : 'nothing to do';
}

/** Is every item in this set at a deliberate final state? */
export const allFinal = (tally) => tally.total > 0 && tally.pending === 0;

// ── the optional explanation ────────────────────────────────────────────────

/**
 * Why the auditor did not experience this item.
 *
 * Optional, always. Requiring it would slow a mobile workflow for a sentence
 * nobody scores, and an auditor who has to type something to move on types
 * anything. It lands in audit_items.na_note, which has existed unused since
 * Phase 4B, and is deliberately distinct from two other free-text fields:
 *
 *   audit_items.note              what the auditor observed about the item
 *   audit_item_photos.note        what one photograph shows
 *   audit_items.na_note           why the item was not assessed   <- this one
 */
export const NA_NOTE_MAX = 200;

export function normaliseNaNote(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, NA_NOTE_MAX);
}

/** Suggestions offered as one-tap chips. Never required, never validated. */
export const NA_NOTE_SUGGESTIONS = Object.freeze([
  'Did not use the spa',
  'Restaurant not visited',
  'Room service not ordered',
  'Pool not used',
  'Gym not visited',
]);
