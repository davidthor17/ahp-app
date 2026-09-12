// Phase 7.3C — a refusal an auditor can never clear is a dead end.
//
// Found live. An entry for an item this build's checklist does not contain is
// refused permanently and kept, which is right: dropping a grade silently is
// the one outcome this queue exists to prevent. But the only way a refusal
// clears is re-editing the cell, and an unknown item has no cell to edit. The
// console offered no discard anywhere, so the entry sat at REFUSED for the
// life of the device: header permanently red, publish permanently gated, and
// nothing the auditor could do about it.
//
// The remedy is narrow on purpose. Discarding is throwing away a grade
// somebody stood in a hotel and made, so it is per entry, never wholesale;
// only for entries already refused for good; only for this audit's own; and
// local, because the row it would have written was never written.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SYNC, createQueue, queueWrite, markFailure, clearWrite,
  discardBlockedEntry, discardableEntries, blockedEntries, blockedCount,
  pendingCount, pendingEntries, sendableEntries, resolveSyncState, syncLabel,
  serializeQueue, deserializeQueue, unknownItemError, blockedReasons, blockedMessage,
  UNKNOWN_ITEM_CODE, FOREIGN_ENTRY_CODE,
} from '../src/framework/syncQueue.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');
const QUEUE = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/framework/syncQueue.js'), 'utf8');

const AUDIT_D = '8781e1cc-831e-4d3e-b429-94ddc423747b';
const AUDIT_C = 'ceddb6bb-22a9-4ef6-8417-604840b6a995';
const RLS = { code: '42501', message: 'refused by policy' };
const patch = (over = {}) => ({ status: 'met', time: '09:00', note: null, critical: false, na_reason: null, na_note: null, ...over });

/** The live shape: one unknown-item refusal beside real outstanding work. */
const stuckQueue = () => {
  const q = createQueue();
  queueWrite(q, 'ZZZ-99', 'morning', patch({ status: 'partial' }), AUDIT_D);
  markFailure(q, 'ZZZ-99', 'morning', unknownItemError('ZZZ-99'));
  queueWrite(q, 'REC-10', 'morning', patch(), AUDIT_D);
  return q;
};

// ── a blocked unknown item can be discarded ─────────────────────────────────

test('a blocked unknown item can be discarded', () => {
  const q = stuckQueue();
  assert.equal(blockedCount(q), 1);
  assert.equal(discardBlockedEntry(q, 'ZZZ-99', 'morning', AUDIT_D), true, 'it says it went');
  assert.equal(blockedCount(q), 0);
  assert.equal(pendingEntries(q).some((e) => e.itemId === 'ZZZ-99'), false, 'and it is gone');
});

test('discarding the last refusal leaves a clean queue and a SYNCED header', () => {
  const q = createQueue();
  queueWrite(q, 'ZZZ-99', 'morning', patch(), AUDIT_D);
  markFailure(q, 'ZZZ-99', 'morning', unknownItemError('ZZZ-99'));
  assert.equal(syncLabel(resolveSyncState({ hasSession: true, pending: 1, blocked: 1 }), 1, 1).text, 'REFUSED 1');

  discardBlockedEntry(q, 'ZZZ-99', 'morning', AUDIT_D);
  assert.equal(blockedCount(q), 0, 'REFUSED count is 0');
  assert.equal(pendingCount(q), 0);
  assert.equal(blockedMessage(blockedReasons(q)), null, 'and the bar has nothing left to say');
  const state = resolveSyncState({ hasSession: true, pending: pendingCount(q), blocked: blockedCount(q) });
  assert.equal(state, SYNC.SYNCED);
  assert.equal(syncLabel(state, 0, 0).text, 'SYNCED');
});

// ── ordinary work is not the auditor's to throw away ────────────────────────

test('a retryable entry cannot be discarded', () => {
  const q = createQueue();
  queueWrite(q, 'REC-01', 'morning', patch(), AUDIT_D);

  assert.equal(discardBlockedEntry(q, 'REC-01', 'morning', AUDIT_D), false, 'it refuses');
  assert.equal(pendingCount(q), 1, 'and the grade is still there');

  // A transient failure counts an attempt and stays sendable. Still not
  // discardable: the server has not refused it, it is on its way.
  markFailure(q, 'REC-01', 'morning', { code: 'TIMEOUT', message: 'slow' });
  assert.equal(blockedCount(q), 0, 'a timeout is not a refusal');
  assert.equal(discardBlockedEntry(q, 'REC-01', 'morning', AUDIT_D), false);
  assert.equal(pendingCount(q), 1);
  assert.equal(sendableEntries(q).length, 1, 'and it is still going to be retried');
});

test('discarding something that is not there is a no-op, not a crash', () => {
  const q = createQueue();
  assert.equal(discardBlockedEntry(q, 'NOPE-01', 'morning', AUDIT_D), false);
  assert.equal(pendingCount(q), 0);
});

// ── one discard touches exactly one entry ───────────────────────────────────

test('valid queue entries remain after discarding one refused entry', () => {
  const q = stuckQueue();
  queueWrite(q, 'REC-11', 'night', patch({ status: 'missed' }), AUDIT_D);
  markFailure(q, 'REC-11', 'night', RLS);            // a second, different refusal

  discardBlockedEntry(q, 'ZZZ-99', 'morning', AUDIT_D);

  assert.deepEqual(pendingEntries(q).map((e) => e.itemId), ['REC-10', 'REC-11'],
    'the valid outstanding write and the other refusal both survive');
  assert.equal(sendableEntries(q).length, 1, 'REC-10 is still going to be sent');
  assert.equal(blockedCount(q), 1, 'and REC-11 is still refused, and still reportable');
  assert.equal(blockedEntries(q)[0].itemId, 'REC-11');
});

// ── audit scoping ───────────────────────────────────────────────────────────

test('a refusal belonging to another audit cannot be discarded from this one', () => {
  const q = createQueue();
  queueWrite(q, 'ZZZ-99', 'morning', patch(), AUDIT_C);
  markFailure(q, 'ZZZ-99', 'morning', unknownItemError('ZZZ-99'));

  assert.equal(discardBlockedEntry(q, 'ZZZ-99', 'morning', AUDIT_D), false, 'not D\'s to discard');
  assert.equal(pendingCount(q), 1, 'it is kept, exactly as it was');
  assert.equal(discardBlockedEntry(q, 'ZZZ-99', 'morning', AUDIT_C), true, 'its own audit may');
  assert.equal(pendingCount(q), 0);
});

test('only this audit\'s refusals are offered a discard at all', () => {
  const q = createQueue();
  queueWrite(q, 'ZZZ-99', 'morning', patch(), AUDIT_D);
  markFailure(q, 'ZZZ-99', 'morning', unknownItemError('ZZZ-99'));
  queueWrite(q, 'OLD-01', 'morning', patch(), AUDIT_C);
  markFailure(q, 'OLD-01', 'morning', { code: FOREIGN_ENTRY_CODE, permanent: true, message: 'elsewhere' });
  queueWrite(q, 'REC-10', 'morning', patch(), AUDIT_D);       // healthy, not offered

  assert.deepEqual(discardableEntries(q, AUDIT_D).map((e) => e.itemId), ['ZZZ-99']);
  assert.deepEqual(discardableEntries(q, AUDIT_C).map((e) => e.itemId), ['OLD-01']);
  // An entry saved before entries carried an audit id belongs to whoever holds
  // it, exactly as the flush already treats it.
  const legacy = createQueue();
  queueWrite(legacy, 'OLD-99', 'morning', patch());
  markFailure(legacy, 'OLD-99', 'morning', unknownItemError('OLD-99'));
  assert.deepEqual(discardableEntries(legacy, AUDIT_D).map((e) => e.itemId), ['OLD-99']);
});

// ── durability ──────────────────────────────────────────────────────────────

test('a discard survives the reload that the refusal survived', () => {
  // The refusal is durable by design: that is what made it inescapable. The
  // discard has to be just as durable, or the next reload brings it back.
  const q = stuckQueue();
  discardBlockedEntry(q, 'ZZZ-99', 'morning', AUDIT_D);

  const restored = deserializeQueue(JSON.parse(JSON.stringify(serializeQueue(q, AUDIT_D))));
  assert.equal(restored.skipped.length, 0);
  assert.deepEqual(pendingEntries(restored.queue).map((e) => e.itemId), ['REC-10'],
    'the discarded entry does not come back, and the good one does');
  assert.equal(blockedCount(restored.queue), 0);
});

test('an undiscarded refusal still comes back, because it is still reportable', () => {
  // Requirement 9, the other half of the same rule: nothing auto-discards.
  const q = stuckQueue();
  const restored = deserializeQueue(JSON.parse(JSON.stringify(serializeQueue(q, AUDIT_D))));
  assert.equal(blockedCount(restored.queue), 1);
  assert.equal(blockedEntries(restored.queue)[0].error.code, UNKNOWN_ITEM_CODE);
});

// ── the normal recovery path is untouched ───────────────────────────────────

test('re-editing a valid cell still clears its refusal and retries it', () => {
  const q = createQueue();
  queueWrite(q, 'REC-08', 'morning', patch({ status: 'partial' }), AUDIT_D);
  markFailure(q, 'REC-08', 'morning', RLS);
  assert.equal(blockedCount(q), 1);
  assert.equal(sendableEntries(q).length, 0);

  queueWrite(q, 'REC-08', 'morning', patch({ status: 'met' }), AUDIT_D);   // the auditor re-grades
  assert.equal(blockedCount(q), 0, 'the refusal is cleared by the edit, with no discard involved');
  assert.equal(sendableEntries(q).length, 1, 'and it will be tried again');
  assert.equal(pendingEntries(q)[0].patch.status, 'met');

  clearWrite(q, 'REC-08', 'morning');
  assert.equal(pendingCount(q), 0);
});

// ── nothing here can reach the server ───────────────────────────────────────

test('discarding touches no server row, and has nothing to touch one with', () => {
  // The row this entry would have written was refused, so it was never
  // written. There is nothing out there to delete, and neither the queue
  // helper nor the console action has any way to delete it.
  const fn = QUEUE.slice(QUEUE.indexOf('export function discardBlockedEntry'), QUEUE.indexOf('export const hasPending'));
  assert.equal(/supabase|fetch\(|\.from\(|\.rpc\(/.test(fn), false, 'the helper is pure queue surgery');
  // Not a blanket ban on the word: `queue.delete(key)` is the whole point, and
  // is asserted below. What must not exist is a PostgREST-shaped delete.
  assert.equal(/\.delete\(\)/.test(fn), false, 'no server-style delete');
  assert.match(fn, /queue\.delete\(key\)/, 'the only deletion is from the Map');

  const action = APP.slice(APP.indexOf('const discardRefused'), APP.indexOf('const discardRefused') + 1200);
  assert.equal(/supabase|from\('audit_items'\)|\.delete\(\)/.test(action), false,
    'and the console action writes nothing anywhere but the device');
  assert.match(action, /persistQueue\(auditId\)/, 'it does write the device cache, which is the point');
});

// ── the wiring ──────────────────────────────────────────────────────────────

test('the console discards through the guarded helper, scoped to the open audit', () => {
  assert.match(APP, /discardBlockedEntry\(pendingRef\.current, itemId, shiftId, auditId\)/);
  assert.match(APP, /if \(!discardBlockedEntry\(pendingRef\.current, itemId, shiftId, auditId\)\) return;/,
    'a refused discard stops there and changes no counters');
});

test('discarding takes two taps, and there is no clear-all anywhere', () => {
  assert.match(APP, /const \[confirmDiscard, setConfirmDiscard\] = useState\(null\);/);
  assert.match(APP, /setConfirmDiscard\(key\)/, 'the first tap only asks');
  assert.match(APP, /onClick=\{\(\) => discardRefused\(e\.itemId, e\.shiftId\)\}/, 'the second tap acts');
  assert.match(APP, /Discard this change\? It will not be saved\./);
  assert.equal(/discardAll|clearAll|Discard all|Clear all/.test(APP), false, 'no wholesale discard exists');
  assert.equal(/discardAll|clearAll/.test(QUEUE), false);
});

test('the refused rows the bar renders are the discardable ones, not every entry', () => {
  assert.match(APP, /const refusedRows = \(queue, auditId\) =>\s*\n\s*discardableEntries\(queue, auditId\)/);
  // Every place the blocked counters are refreshed refreshes the list too, or
  // the bar would offer a discard for something already gone.
  // Four calls, not five: the useState declaration reads `setRefusedList]`,
  // with a bracket, so it is not a call and is deliberately not counted.
  assert.equal((APP.match(/setRefusedList\(/g) || []).length, 4,
    'hydrate, the end of a flush, the unknown-item refusal, and the discard itself');
});
