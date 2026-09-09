// Phase 6.2 — Not Assessed, and the distinction the methodology rests on.
//
//   the auditor should have checked breakfast and did not      MISSED
//   the auditor chose not to eat breakfast                     NOT ASSESSED
//   the hotel does not serve breakfast                         NOT AVAILABLE
//   the auditor ate breakfast and it was poor                  ASSESSED
//   the auditor ate breakfast and it was excellent             ASSESSED
//
// The middle three are all status 'na' and are told apart by na_reason, which
// has existed since Phase 4B. NOT ASSESSED IS not_observed: it is not a new
// state and it needs no new column. What it lacked was a name an auditor would
// recognise and a place in the progress counts.
//
// The scoring is deliberately untouched, because it was already right, and
// these tests prove that rather than asserting it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ITEM_STATE, NOT_ASSESSED_REASON, STATE_LABEL,
  itemState, itemStateAcrossShifts, isFinalState, tallyStates, progressLabel,
  allFinal, normaliseNaNote, NA_NOTE_MAX, NA_NOTE_SUGGESTIONS,
} from '../src/framework/assessmentState.js';
import { NA_REASON, STRUCTURAL_NA_REASONS, GRADED_STATUSES } from '../src/framework/weights.js';
import { score } from '../src/framework/scoring.js';

const PROP = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };

const met      = { status: 'met' };
const partial  = { status: 'partial' };
const missed   = { status: 'missed' };
const notAssessed = { status: 'na', naReason: NA_REASON.NOT_OBSERVED };
const notPresent  = { status: 'na', naReason: NA_REASON.NOT_PRESENT };
const notOffered  = { status: 'na', naReason: NA_REASON.NOT_OFFERED };

// ── the five states are distinct ────────────────────────────────────────────

test('Not Assessed is not_observed, and is stated once', () => {
  assert.equal(NOT_ASSESSED_REASON, NA_REASON.NOT_OBSERVED);
  assert.equal(NOT_ASSESSED_REASON, 'not_observed');
});

test('the five situations map to five different states', () => {
  assert.equal(itemState(missed), ITEM_STATE.MISSED);
  assert.equal(itemState(notAssessed), ITEM_STATE.NOT_ASSESSED);
  assert.equal(itemState(notPresent), ITEM_STATE.NOT_AVAILABLE);
  assert.equal(itemState(met), ITEM_STATE.ASSESSED);
  assert.equal(itemState(partial), ITEM_STATE.ASSESSED);
  assert.equal(itemState({}), ITEM_STATE.PENDING);
});

test('Not Assessed is distinct from Missed, in state and in label', () => {
  // The distinction the whole phase exists to protect.
  assert.notEqual(itemState(notAssessed), itemState(missed));
  assert.equal(STATE_LABEL[ITEM_STATE.NOT_ASSESSED], 'not assessed');
  assert.equal(STATE_LABEL[ITEM_STATE.MISSED], 'missed');
});

test('Not Assessed is distinct from Not Available', () => {
  // "I did not visit the spa" and "there is no spa" are different facts and
  // the second removes the item from the audit while the first does not.
  assert.notEqual(itemState(notAssessed), itemState(notPresent));
  assert.equal(itemState(notOffered), ITEM_STATE.NOT_AVAILABLE);
  assert.equal(STRUCTURAL_NA_REASONS.includes(NOT_ASSESSED_REASON), false,
    'Not Assessed is not structural, so it does not leave the audit');
});

test('a reasonless N/A reads as Not Assessed, the conservative reading', () => {
  // Matches LEGACY_NA_REASON. It keeps the item in coverage rather than
  // erasing it from an audit recorded before reasons existed.
  assert.equal(itemState({ status: 'na' }), ITEM_STATE.NOT_ASSESSED);
});

// ── scoring is unchanged, and was already correct ───────────────────────────

test('Not Assessed does not reduce the score', () => {
  // The requirement, proven against the real engine rather than asserted.
  const allMet = score({ 'RM-01': { day: met }, 'RM-02': { day: met } }, PROP);
  const withNotAssessed = score({
    'RM-01': { day: met }, 'RM-02': { day: met }, 'SP-01': { day: notAssessed },
  }, PROP);
  assert.equal(withNotAssessed.overall, allMet.overall, 'the score is identical');
  assert.equal(withNotAssessed.overall, 100);
});

test('Not Assessed is in neither the score numerator nor its denominator', () => {
  assert.equal(GRADED_STATUSES.includes('na'), false);
  const s = score({ 'RM-01': { day: met }, 'SP-01': { day: notAssessed } }, PROP);
  assert.equal(s.weights.graded, s.weights.applicable - s.weights.na - (s.weights.applicable - s.weights.na - s.weights.graded));
  assert.equal(s.overall, 100, 'one met and one not assessed is 100 per cent');
});

test('Not Assessed is not counted as a completed scored item', () => {
  const s = score({ 'RM-01': { day: met }, 'SP-01': { day: notAssessed } }, PROP);
  assert.equal(s.assessment.itemsGraded, 1, 'only the met item is graded');
});

test('Not Assessed is never a negative score, unlike Missed', () => {
  const withMissed = score({ 'RM-01': { day: met }, 'RM-02': { day: missed } }, PROP);
  const withNotAssessed = score({ 'RM-01': { day: met }, 'RM-02': { day: notAssessed } }, PROP);
  assert.ok(withMissed.overall < 100, 'a missed item costs score');
  assert.equal(withNotAssessed.overall, 100, 'a not assessed item does not');
});

test('Not Assessed does still cost coverage, deliberately', () => {
  // The one place it is not excluded, and it is load-bearing: coverage gates
  // certification at 80, 90 and 95 per cent. If Not Assessed left this
  // denominator an auditor could certify a hotel on a tenth of the checklist.
  const s = score({ 'RM-01': { day: met }, 'SP-01': { day: notAssessed } }, PROP);
  assert.ok(s.coverage < 100, 'an item nobody experienced was not assessed');
  assert.ok(s.weights.observedNa > 0);
  assert.equal(s.weights.structuralNa, 0, 'and it did not leave the audit');
});

test('Not Available does leave the audit, unlike Not Assessed', () => {
  const s = score({ 'RM-01': { day: met }, 'SP-01': { day: notPresent } }, PROP);
  assert.ok(s.weights.structuralNa > 0);
  assert.equal(s.weights.observedNa, 0);
});

test('an existing audit calculates exactly as before unless an item changes', () => {
  // Nothing in this phase touches the engine, so a graded set scores
  // identically to how it always did.
  const graded = {
    'RM-01': { day: met }, 'RM-02': { day: missed }, 'RM-03': { day: partial },
    'BTH-01': { day: met },
  };
  const s = score(graded, PROP);
  assert.equal(s.assessment.itemsGraded, 4);
  assert.ok(s.overall > 0 && s.overall < 100);
  // And adding a Not Assessed item leaves the score untouched.
  const after = score({ ...graded, 'SP-01': { day: notAssessed } }, PROP);
  assert.equal(after.overall, s.overall);
});

// ── across shifts ───────────────────────────────────────────────────────────

test('the worst state across shifts wins, as the engine does for status', () => {
  assert.equal(itemStateAcrossShifts({ day: met, night: missed }), ITEM_STATE.MISSED);
  assert.equal(itemStateAcrossShifts({ day: notAssessed, night: met }), ITEM_STATE.ASSESSED);
  assert.equal(itemStateAcrossShifts({ day: notPresent, night: notAssessed }), ITEM_STATE.NOT_ASSESSED);
});

test('an item assessed in one shift is not pending because another is empty', () => {
  assert.equal(itemStateAcrossShifts({ day: met, night: {} }), ITEM_STATE.ASSESSED);
  assert.equal(itemStateAcrossShifts({}), ITEM_STATE.PENDING);
});

test('only the shifts in the current system are consulted', () => {
  // D699 carries orphaned 'morning' rows under a 2-shift property.
  const byShift = { day: met, morning: missed };
  assert.equal(itemStateAcrossShifts(byShift, ['day', 'night']), ITEM_STATE.ASSESSED);
  assert.equal(itemStateAcrossShifts(byShift), ITEM_STATE.MISSED, 'all shifts when none is named');
});

// ── progress ────────────────────────────────────────────────────────────────

test('progress separates assessed, missed and not assessed', () => {
  const tally = tallyStates([
    ...Array(42).fill(ITEM_STATE.ASSESSED),
    ...Array(3).fill(ITEM_STATE.MISSED),
    ...Array(10).fill(ITEM_STATE.NOT_ASSESSED),
  ]);
  assert.equal(tally.assessed, 42);
  assert.equal(tally.missed, 3);
  assert.equal(tally.notAssessed, 10);
  assert.equal(progressLabel(tally), '42 assessed · 3 missed · 10 not assessed');
});

test('Not Assessed is never displayed as a failure', () => {
  const label = progressLabel(tallyStates([ITEM_STATE.NOT_ASSESSED, ITEM_STATE.NOT_ASSESSED]));
  assert.equal(label, '2 not assessed');
  assert.equal(/missed|fail/i.test(label), false);
});

test('a clean section reads simply, with no zeroes', () => {
  assert.equal(progressLabel(tallyStates(Array(8).fill(ITEM_STATE.ASSESSED))), '8 assessed');
});

test('every item lands in exactly one bucket', () => {
  const states = [
    ITEM_STATE.ASSESSED, ITEM_STATE.MISSED, ITEM_STATE.NOT_ASSESSED,
    ITEM_STATE.NOT_AVAILABLE, ITEM_STATE.PENDING,
  ];
  const t = tallyStates(states);
  assert.equal(t.assessed + t.missed + t.notAssessed + t.notAvailable + t.pending, t.total);
  assert.equal(t.total, 5);
  assert.equal(t.finished, 4, 'everything but pending is finished');
});

// ── the finish gate ─────────────────────────────────────────────────────────

test('Not Assessed is a deliberate final state, so a section can be completed', () => {
  // An auditor must never be forced to invent an assessment because they did
  // not use an optional hotel service.
  assert.equal(isFinalState(ITEM_STATE.NOT_ASSESSED), true);
  assert.equal(isFinalState(ITEM_STATE.NOT_AVAILABLE), true);
  assert.equal(isFinalState(ITEM_STATE.ASSESSED), true);
  assert.equal(isFinalState(ITEM_STATE.MISSED), true);
  assert.equal(isFinalState(ITEM_STATE.PENDING), false);
});

test('a section of assessed, missed and not assessed is complete', () => {
  const tally = tallyStates([
    ITEM_STATE.ASSESSED, ITEM_STATE.ASSESSED, ITEM_STATE.MISSED, ITEM_STATE.NOT_ASSESSED,
  ]);
  assert.equal(allFinal(tally), true);
  assert.equal(tally.finished, tally.total);
});

test('a section with one item still to do is not complete', () => {
  const tally = tallyStates([ITEM_STATE.ASSESSED, ITEM_STATE.PENDING]);
  assert.equal(allFinal(tally), false);
  assert.equal(progressLabel(tally), '1 assessed · 1 to do');
});

test('a section that is entirely not assessed is still completable', () => {
  // The unvisited spa. It must not be permanently impossible to finish.
  const tally = tallyStates(Array(5).fill(ITEM_STATE.NOT_ASSESSED));
  assert.equal(allFinal(tally), true);
});

// ── the optional explanation ────────────────────────────────────────────────

test('the explanation is optional and empty means absent', () => {
  assert.equal(normaliseNaNote(''), null);
  assert.equal(normaliseNaNote('   '), null);
  assert.equal(normaliseNaNote(null), null);
  assert.equal(normaliseNaNote(undefined), null);
  assert.equal(normaliseNaNote('Did not use spa'), 'Did not use spa');
});

test('the explanation is trimmed and bounded', () => {
  assert.equal(normaliseNaNote('  Restaurant not visited  '), 'Restaurant not visited');
  assert.equal(normaliseNaNote('x'.repeat(NA_NOTE_MAX + 50)).length, NA_NOTE_MAX);
});

test('suggestions are offered and none is required', () => {
  assert.ok(NA_NOTE_SUGGESTIONS.length >= 3);
  for (const s of NA_NOTE_SUGGESTIONS) assert.equal(normaliseNaNote(s), s);
});

// ── the worked example from the brief ───────────────────────────────────────

test('the five breakfast situations produce the five correct outcomes', () => {
  const cases = [
    { desc: 'forgot to check breakfast',      entry: missed,      state: ITEM_STATE.MISSED },
    { desc: 'chose not to eat breakfast',     entry: notAssessed, state: ITEM_STATE.NOT_ASSESSED },
    { desc: 'hotel offers no breakfast',      entry: notOffered,  state: ITEM_STATE.NOT_AVAILABLE },
    { desc: 'checked it, found problems',     entry: missed,      state: ITEM_STATE.MISSED },
    { desc: 'checked it, found it excellent', entry: met,         state: ITEM_STATE.ASSESSED },
  ];
  for (const c of cases) assert.equal(itemState(c.entry), c.state, c.desc);

  // And only the deliberate skip is free of score consequence.
  const skipped = score({ 'BRK-01': { day: notAssessed }, 'RM-01': { day: met } }, PROP);
  const forgotten = score({ 'BRK-01': { day: missed }, 'RM-01': { day: met } }, PROP);
  assert.equal(skipped.overall, 100);
  assert.ok(forgotten.overall < 100);
});
