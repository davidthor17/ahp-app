// Phase 6.3 — the auditor must never have to hunt for the next action.
//
// The field failure this covers: an auditor completed a real hotel checklist
// and could not find FINISH AUDIT. The inspection found the gate was never the
// problem. FINISH was guarded by `!readOnly` alone and was always enabled; it
// sat 885px below the fold on a 375x812 phone, under fifteen section cards,
// reached from a section screen that had no exit at its bottom at all.
//
// So nothing here makes finishing stricter. It makes the state legible: how
// much is left, whether it can be finished, and if not, exactly which sections
// and how many items.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_STATE, ACTION,
  auditCompletion, canFinish, finishBlocker, primaryAction,
  nextIncompleteSection, sectionAfter, sectionsNeedingAttention, sectionAttentionNote,
} from '../src/framework/auditCompletion.js';
import { ITEM_STATE } from '../src/framework/assessmentState.js';
import { NA_REASON } from '../src/framework/weights.js';

const met = { status: 'met' };
const missed = { status: 'missed' };
const notAssessed = { status: 'na', naReason: NA_REASON.NOT_OBSERVED };
const notAvailable = { status: 'na', naReason: NA_REASON.NOT_PRESENT };

const SECTIONS = [
  { id: 'room', label: 'Room Quality', items: [{ id: 'RM-01', label: 'a' }, { id: 'RM-02', label: 'b' }, { id: 'RM-03', label: 'c' }] },
  { id: 'spa', label: 'Spa', items: [{ id: 'SP-01', label: 'd' }, { id: 'SP-02', label: 'e' }] },
  { id: 'bath', label: 'Bathroom', items: [{ id: 'BT-01', label: 'f' }] },
];

const build = (audit, over = {}) =>
  auditCompletion({ sections: SECTIONS, audit, shiftIds: ['day'], ...over });

const g = (entry) => ({ day: entry });

// ── the state machine ───────────────────────────────────────────────────────

test('an untouched audit is NOT_STARTED', () => {
  const c = build({});
  assert.equal(c.state, AUDIT_STATE.NOT_STARTED);
  assert.equal(c.remaining, 6);
  assert.equal(c.percent, 0);
});

test('a partly graded audit is IN_PROGRESS', () => {
  const c = build({ 'RM-01': g(met), 'RM-02': g(missed) });
  assert.equal(c.state, AUDIT_STATE.IN_PROGRESS);
  assert.equal(c.remaining, 4);
});

test('every item at a deliberate final state is READY_TO_FINISH', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(missed), 'RM-03': g(notAssessed),
    'SP-01': g(notAvailable), 'SP-02': g(notAssessed), 'BT-01': g(met),
  });
  assert.equal(c.state, AUDIT_STATE.READY_TO_FINISH);
  assert.equal(c.remaining, 0);
  assert.equal(c.percent, 100);
});

test('a published audit reports PUBLISHED whatever its items say', () => {
  const c = build({ 'RM-01': g(met) }, { status: 'published' });
  assert.equal(c.state, AUDIT_STATE.PUBLISHED);
});

// ── the existing finish rule is preserved exactly ───────────────────────────

test('Not Assessed does not hold the audit open', () => {
  // The rule that must not get stricter: an auditor is never made to invent an
  // assessment for a spa they did not visit.
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(notAssessed), 'SP-02': g(notAssessed), 'BT-01': g(met),
  });
  assert.equal(canFinish(c), true);
  assert.equal(finishBlocker(c).blocked, false);
});

test('Not Available does not hold the audit open either', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(notAvailable), 'SP-02': g(notAvailable), 'BT-01': g(met),
  });
  assert.equal(canFinish(c), true);
});

test('Missed does not hold the audit open', () => {
  const c = build({
    'RM-01': g(missed), 'RM-02': g(missed), 'RM-03': g(missed),
    'SP-01': g(missed), 'SP-02': g(missed), 'BT-01': g(missed),
  });
  assert.equal(canFinish(c), true, 'a missed item is a determination, not a gap');
});

test('only an untouched item holds the audit open', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(met), 'SP-02': g(met),
  });
  assert.equal(canFinish(c), false);
  assert.equal(c.remaining, 1);
});

test('an item with a note or a photo but no grade is still remaining', () => {
  // itemState keys on status. Evidence is not a determination.
  const c = build({ 'RM-01': { day: { note: 'saw something', naNote: null } } });
  assert.equal(c.remaining, 6);
  assert.equal(c.state, AUDIT_STATE.NOT_STARTED);
});

test('an audit with no applicable items cannot be finished', () => {
  const c = auditCompletion({ sections: SECTIONS, isApplicable: () => false, audit: {}, shiftIds: ['day'] });
  assert.equal(canFinish(c), false);
  assert.equal(finishBlocker(c).reason, 'empty');
});

// ── the explanation is specific, never generic ──────────────────────────────

test('the blocker names the sections and counts the items', () => {
  const c = build({ 'RM-01': g(met), 'BT-01': g(met) });
  const b = finishBlocker(c);
  assert.equal(b.blocked, true);
  assert.equal(b.reason, 'remaining');
  assert.match(b.message, /4 items still to do/);
  assert.match(b.message, /Room Quality \(2\)/);
  assert.match(b.message, /Spa \(2\)/);
  assert.equal(/cannot finish/i.test(b.message), false, 'never a generic refusal');
});

test('one remaining item reads in the singular', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met), 'SP-01': g(met), 'SP-02': g(met),
  });
  assert.match(finishBlocker(c).message, /1 item still to do/);
});

test('the blocker carries the sections so the UI can link to them', () => {
  const c = build({ 'RM-01': g(met) });
  const b = finishBlocker(c);
  assert.ok(Array.isArray(b.sections));
  assert.deepEqual(b.sections.map(s => s.id).sort(), ['bath', 'room', 'spa']);
});

test('many incomplete sections are summarised rather than listed forever', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i}`, label: `Section ${i}`, items: [{ id: `X-${i}`, label: 'x' }],
  }));
  const b = finishBlocker(auditCompletion({ sections: many, audit: {}, shiftIds: ['day'] }));
  assert.match(b.message, /and 5 more/);
});

// ── the primary action ──────────────────────────────────────────────────────

test('there is exactly one primary action at every stage', () => {
  assert.equal(primaryAction(build({})).action, ACTION.START);
  assert.equal(primaryAction(build({ 'RM-01': g(met) })).action, ACTION.CONTINUE);

  const done = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(met), 'SP-02': g(met), 'BT-01': g(met),
  });
  assert.equal(primaryAction(done).action, ACTION.FINISH);
  assert.equal(primaryAction(done).label, 'FINISH AUDIT');
  assert.equal(primaryAction(done).tone, 'ready');
});

test('a published audit offers the report, not another finish', () => {
  const c = build({ 'RM-01': g(met) }, { status: 'published' });
  assert.equal(primaryAction(c).action, ACTION.VIEW_REPORT);
});

test('the action caption shows progress without the auditor scrolling', () => {
  const c = build({ 'RM-01': g(met), 'RM-02': g(missed) });
  const a = primaryAction(c);
  assert.match(a.caption, /2 of 6 done/);
  assert.match(a.caption, /4 to do/);
});

test('the ready caption uses the three-way split, not one total', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(missed), 'RM-03': g(notAssessed),
    'SP-01': g(met), 'SP-02': g(met), 'BT-01': g(met),
  });
  const a = primaryAction(c);
  assert.match(a.caption, /4 assessed/);
  assert.match(a.caption, /1 missed/);
  assert.match(a.caption, /1 not assessed/);
});

// ── moving between sections ─────────────────────────────────────────────────

test('the next incomplete section is found, and wraps', () => {
  const c = build({ 'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met) });
  assert.equal(nextIncompleteSection(c).id, 'spa');
  assert.equal(nextIncompleteSection(c, 'spa').id, 'bath');
  assert.equal(nextIncompleteSection(c, 'bath').id, 'spa', 'wraps rather than dead-ending');
});

test('there is no next incomplete section when everything is done', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(met), 'SP-02': g(met), 'BT-01': g(met),
  });
  assert.equal(nextIncompleteSection(c), null);
});

test('the plain next section is available for a finished one', () => {
  const c = build({});
  assert.equal(sectionAfter(c, 'room').id, 'spa');
  assert.equal(sectionAfter(c, 'bath'), null, 'the last section has none');
});

// ── the completion screen ───────────────────────────────────────────────────

test('sections are broken down individually', () => {
  const c = build({ 'RM-01': g(met), 'RM-02': g(missed), 'SP-01': g(notAssessed) });
  const room = c.bySection.find(s => s.id === 'room');
  assert.equal(room.total, 3);
  assert.equal(room.remaining, 1);
  assert.equal(room.complete, false);
  assert.equal(room.tally.assessed, 1);
  assert.equal(room.tally.missed, 1);
});

test('attention lists unfinished sections first, then not assessed', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(notAssessed), 'SP-02': g(notAssessed),
  });
  const attention = sectionsNeedingAttention(c);
  assert.equal(attention[0].id, 'bath', 'the unfinished one first');
  assert.equal(attention[1].id, 'spa', 'then the fully not-assessed one');
});

test('a complete section with no Not Assessed needs no attention', () => {
  const c = build({
    'RM-01': g(met), 'RM-02': g(met), 'RM-03': g(met),
    'SP-01': g(met), 'SP-02': g(met), 'BT-01': g(met),
  });
  assert.equal(sectionsNeedingAttention(c).length, 0);
});

test('Not Assessed is surfaced without being called an error', () => {
  const c = build({ 'SP-01': g(notAssessed), 'SP-02': g(notAssessed) });
  const spa = c.bySection.find(s => s.id === 'spa');
  const note = sectionAttentionNote(spa);
  assert.equal(note.text, '2 not assessed');
  assert.equal(note.tone, 'muted', 'muted, not bad: it is a valid final state');
  assert.equal(/error|problem|fail/i.test(note.text), false);
});

test('a remaining section is marked clearly and a complete one plainly', () => {
  const c = build({ 'RM-01': g(met) });
  assert.equal(sectionAttentionNote(c.bySection.find(s => s.id === 'room')).tone, 'bad');
  assert.match(sectionAttentionNote(c.bySection.find(s => s.id === 'room')).text, /2 items remaining/);

  const done = build({ 'BT-01': g(met) }).bySection.find(s => s.id === 'bath');
  assert.equal(sectionAttentionNote(done).text, 'Complete');
  assert.equal(sectionAttentionNote(done).tone, 'ok');
});

// ── applicability and shifts are honoured, not reimplemented ────────────────

test('items the checklist pin excludes are not counted as remaining', () => {
  const c = auditCompletion({
    sections: SECTIONS, audit: {}, shiftIds: ['day'],
    isApplicable: (id) => id !== 'SP-01' && id !== 'SP-02',
  });
  assert.equal(c.tally.total, 4, 'the spa items are out of scope entirely');
  assert.equal(c.bySection.find(s => s.id === 'spa'), undefined, 'and the section vanishes');
});

test('an item graded in any shift counts as done', () => {
  const c = auditCompletion({
    sections: SECTIONS, audit: { 'RM-01': { night: met } }, shiftIds: ['day', 'night'],
  });
  assert.equal(c.remaining, 5);
});

test('a grade in a shift the property no longer uses does not count', () => {
  // D699 carries orphaned 'morning' rows under a 2-shift property.
  const c = auditCompletion({
    sections: SECTIONS, audit: { 'RM-01': { morning: met } }, shiftIds: ['day', 'night'],
  });
  assert.equal(c.remaining, 6, 'and the item is still to do');
});

// ── the long-audit case from the field ──────────────────────────────────────

test('a 133 item audit reports one clear next action, not a hunt', () => {
  const big = Array.from({ length: 15 }, (_, s) => ({
    id: `sec${s}`, label: `Section ${s}`,
    items: Array.from({ length: 9 }, (_, i) => ({ id: `S${s}-I${i}`, label: 'x' })),
  }));
  const audit = {};
  big.forEach((sec, s) => sec.items.forEach((it, i) => {
    if (!(s === 14 && i > 5)) audit[it.id] = g(met);
  }));

  const c = auditCompletion({ sections: big, audit, shiftIds: ['day'] });
  assert.equal(c.state, AUDIT_STATE.IN_PROGRESS);
  assert.equal(c.remaining, 3);
  assert.equal(primaryAction(c).action, ACTION.CONTINUE);
  assert.match(finishBlocker(c).message, /3 items still to do: Section 14 \(3\)/);
  assert.equal(nextIncompleteSection(c).id, 'sec14', 'and it knows where to send them');
});
