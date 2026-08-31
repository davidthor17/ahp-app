// Phase 5.7 — an N/A reason has to survive the database.
//
// The reason was computed in setStatus, stored in React state, written to
// localStorage, and then dropped three times: the pushItem patch left it out,
// and both hydration paths rebuilt entries without it. So a structural N/A came
// back reasonless, LEGACY_NA_REASON read that as not_observed, and the item
// moved from "excluded from this audit" to "in scope and unassessed". Coverage
// fell and the structural cap stopped applying.
//
// Nothing had been lost in production, because no row anywhere carries
// status 'na'. It was latent, and these tests keep it that way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import {
  NA_REASON, NA_REASONS, STRUCTURAL_NA_REASONS, LEGACY_NA_REASON, STRUCTURAL_NA_CAP_PCT,
} from '../src/framework/weights.js';

const PROP = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };

/**
 * The console's write and read of one item, as App.jsx performs them.
 *
 * `toRow` is the pushItem patch. `fromRow` is the hydration mapping, and both
 * the remote pull and the reviewer open build entries the same way. Modelling
 * both halves here is the point: the defect was never in the engine, it was in
 * what the console chose to carry across the boundary.
 */
const toRow = (entry) => ({
  status: entry.status,
  time: entry.time || null,
  note: entry.note || null,
  critical: !!entry.critical,
  na_reason: entry.naReason || null,
  na_note: null,
});

const fromRow = (row) => ({
  status: row.status,
  note: row.note,
  time: row.time,
  critical: !!row.critical,
  naReason: row.na_reason || null,
});

/** Write an audit out and read it back, exactly as a reload would. */
const roundTrip = (graded) => {
  const out = {};
  for (const [itemId, byShift] of Object.entries(graded)) {
    out[itemId] = {};
    for (const [shiftId, entry] of Object.entries(byShift)) {
      out[itemId][shiftId] = fromRow(toRow(entry));
    }
  }
  return out;
};

const na = (reason) => ({ day: { status: 'na', naReason: reason, time: '09:00' } });

// ── the round trip ──────────────────────────────────────────────────────────

test('every N/A reason survives the write and the read', () => {
  for (const reason of NA_REASONS) {
    const back = roundTrip({ 'SP-01': na(reason) });
    assert.equal(back['SP-01'].day.naReason, reason, `${reason} must come back intact`);
    assert.equal(back['SP-01'].day.status, 'na');
  }
});

test('the patch that goes to Supabase actually carries the reason', () => {
  // The exact defect: this key was absent.
  const patch = toRow({ status: 'na', naReason: NA_REASON.NOT_PRESENT, time: '09:00' });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'na_reason'), true);
  assert.equal(patch.na_reason, 'not_present');
  assert.deepEqual(Object.keys(patch).sort(),
    ['critical', 'na_note', 'na_reason', 'note', 'status', 'time']);
});

test('a graded status carries no reason, so a stale one cannot linger', () => {
  const patch = toRow({ status: 'met', naReason: null, time: '09:00' });
  assert.equal(patch.na_reason, null);
});

test('note and critical still survive alongside the reason', () => {
  const back = roundTrip({
    'RM-02': { day: { status: 'missed', note: 'Bathroom, room 402.', critical: true, time: '09:05' } },
  });
  assert.equal(back['RM-02'].day.note, 'Bathroom, room 402.');
  assert.equal(back['RM-02'].day.critical, true);
  assert.equal(back['RM-02'].day.naReason, null);
});

// ── the three states stay distinct through a reload ─────────────────────────

test('structural and observational stay distinct after a reload', () => {
  const graded = {
    'SP-01': na(NA_REASON.NOT_PRESENT),
    'SP-02': na(NA_REASON.NOT_OFFERED),
    'SP-03': na(NA_REASON.NOT_OBSERVED),
  };
  const s = score(roundTrip(graded), PROP);

  assert.equal(s.counts.structuralNa, 2, 'not_present and not_offered leave the audit');
  assert.equal(s.counts.observedNa, 1, 'not_observed stays in scope');
  assert.deepEqual(s.structuralNaItems.sort(), ['SP-01', 'SP-02']);
});

test('the reason a reload produces is the reason that was recorded', () => {
  for (const reason of NA_REASONS) {
    const s = score(roundTrip({ 'SP-01': na(reason) }), PROP);
    const structural = STRUCTURAL_NA_REASONS.includes(reason);
    assert.equal(s.counts.structuralNa, structural ? 1 : 0, `${reason}`);
    assert.equal(s.counts.observedNa, structural ? 0 : 1, `${reason}`);
  }
});

test('the defect, reproduced: dropping the reason turns structural into observational', () => {
  // The old mapping, without na_reason. Kept as a test so the regression is
  // named rather than merely prevented.
  const lossy = (graded) => {
    const out = {};
    for (const [itemId, byShift] of Object.entries(graded)) {
      out[itemId] = {};
      for (const [shiftId, e] of Object.entries(byShift)) {
        out[itemId][shiftId] = { status: e.status, note: e.note || null, time: e.time, critical: !!e.critical };
      }
    }
    return out;
  };
  const graded = { 'SP-01': na(NA_REASON.NOT_PRESENT) };

  const kept = score(roundTrip(graded), PROP);
  const lost = score(lossy(graded), PROP);

  assert.equal(kept.counts.structuralNa, 1);
  assert.equal(lost.counts.structuralNa, 0, 'the old mapping loses it');
  assert.equal(lost.counts.observedNa, 1, 'and it silently becomes observational');
  // The item goes back into the coverage denominator. On one item of a 298
  // weight catalogue the percentage rounds to the same figure, so the weights
  // are what show it: the denominator grows by exactly that item's weight.
  assert.ok(lost.weights.inScope > kept.weights.inScope,
    'the excluded item returns to the denominator');
  assert.equal(lost.weights.structuralNa, 0);
  assert.ok(kept.weights.structuralNa > 0);
});

// ── legacy, reasonless N/A ──────────────────────────────────────────────────

test('a reasonless N/A is still read as observational', () => {
  const back = roundTrip({ 'SP-01': { day: { status: 'na', time: '09:00' } } });
  assert.equal(back['SP-01'].day.naReason, null, 'nothing is invented on the way back');

  const s = score(back, PROP);
  assert.equal(s.counts.structuralNa, 0);
  assert.equal(s.counts.observedNa, 1);
  assert.equal(LEGACY_NA_REASON, NA_REASON.NOT_OBSERVED);
});

test('reasonless N/A never improves a historical score', () => {
  // Observational is the conservative reading: the item stays in the coverage
  // denominator. Treating it as structural would remove it and raise coverage,
  // which is exactly the direction an inference must not go.
  const reasonless = { 'SP-01': { day: { status: 'na', time: '09:00' } }, 'RM-01': { day: { status: 'met' } } };
  const asStructural = { 'SP-01': na(NA_REASON.NOT_PRESENT), 'RM-01': { day: { status: 'met' } } };

  const legacy = score(roundTrip(reasonless), PROP);
  const structural = score(roundTrip(asStructural), PROP);

  assert.ok(legacy.weights.inScope > structural.weights.inScope,
    'the legacy reading keeps the item in the coverage denominator');
  assert.ok(legacy.coverage <= structural.coverage,
    'so it is never the more generous reading');
  assert.equal(legacy.counts.structuralNa, 0);
});

test('the structural cap still applies to reasons that survived a reload', () => {
  // Enough structural N/A to breach the 5 per cent cap, written and read back.
  const graded = {};
  for (let i = 1; i <= 30; i++) {
    graded[`PRE-${String(i).padStart(2, '0')}`] = na(NA_REASON.NOT_PRESENT);
  }
  graded['RM-01'] = { day: { status: 'met' } };

  const s = score(roundTrip(graded), PROP);
  assert.ok(s.structuralNaShare > STRUCTURAL_NA_CAP_PCT, 'the share is measured');
  assert.equal(s.structuralNaCapExceeded, true, 'and the cap still fires after a reload');
});

// ── the vocabulary itself ───────────────────────────────────────────────────

test('the three reasons are exactly what the check constraint permits', () => {
  // Migration A constrains na_reason to null or these three. Drift here would
  // make a legitimate write fail at the database.
  assert.deepEqual([...NA_REASONS].sort(), ['not_observed', 'not_offered', 'not_present']);
  assert.deepEqual([...STRUCTURAL_NA_REASONS].sort(), ['not_offered', 'not_present']);
  assert.equal(NA_REASONS.length, 3);
});
