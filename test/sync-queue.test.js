// Phase 5.8 P0 — a write that failed must stay outstanding, and the header
// must never claim otherwise.
//
// The two defects these cover, both found in the field readiness inspection:
//
//   1. pushItem caught its error, set syncState 'error', and dropped the write.
//      The next successful write of a different item set 'synced' again, so the
//      lost grade left no trace anywhere in the UI.
//   2. pushItem returned early when the session was gone, before touching
//      syncState at all. Every grade after an expired session went nowhere
//      while the header still read SYNCED.
//
// Both are now impossible by construction: SYNCED is derived from an empty
// queue and a live session, never assigned by whichever path ran last.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC, createQueue, queueWrite, clearWrite, pendingCount, pendingEntries,
  hasPending, resolveSyncState, syncLabel, applyPending, writeKey,
} from '../src/framework/syncQueue.js';

const patch = (over = {}) => ({
  status: 'met', time: '09:00', note: null, critical: false,
  na_reason: null, na_note: null, ...over,
});

// ── the queue ───────────────────────────────────────────────────────────────

test('a queued write is outstanding until it is cleared', () => {
  const q = createQueue();
  assert.equal(hasPending(q), false);

  queueWrite(q, 'RM-01', 'morning', patch());
  assert.equal(pendingCount(q), 1);
  assert.equal(hasPending(q), true);

  clearWrite(q, 'RM-01', 'morning');
  assert.equal(pendingCount(q), 0);
});

test('the same item and shift collapses to the newest patch', () => {
  // Regrading a cell before the first write lands should send one row, not two.
  const q = createQueue();
  queueWrite(q, 'RM-01', 'morning', patch({ status: 'met' }));
  queueWrite(q, 'RM-01', 'morning', patch({ status: 'missed' }));

  assert.equal(pendingCount(q), 1);
  assert.equal(pendingEntries(q)[0].patch.status, 'missed');
});

test('the same item in different shifts stays separate', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'morning', patch());
  queueWrite(q, 'RM-01', 'evening', patch());
  assert.equal(pendingCount(q), 2);
  assert.notEqual(writeKey('RM-01', 'morning'), writeKey('RM-01', 'evening'));
});

test('retry order is the order things were graded', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'morning', patch());
  queueWrite(q, 'RM-02', 'morning', patch());
  queueWrite(q, 'RM-03', 'morning', patch());
  assert.deepEqual(pendingEntries(q).map(e => e.itemId), ['RM-01', 'RM-02', 'RM-03']);
});

// ── the honest state ────────────────────────────────────────────────────────

test('no session is never SYNCED, whatever else is true', () => {
  // Defect 2. This is the one that let an expired session look healthy.
  assert.equal(resolveSyncState({ hasSession: false, pending: 0 }), SYNC.SIGNED_OUT);
  assert.equal(resolveSyncState({ hasSession: false, pending: 4 }), SYNC.SIGNED_OUT);
  assert.equal(resolveSyncState({ hasSession: false, pending: 0, lastError: true }), SYNC.SIGNED_OUT);
});

test('outstanding writes are never SYNCED', () => {
  assert.equal(resolveSyncState({ hasSession: true, pending: 1 }), SYNC.PENDING);
  assert.equal(resolveSyncState({ hasSession: true, pending: 9 }), SYNC.PENDING);
});

test('a failure outranks plain pending', () => {
  assert.equal(resolveSyncState({ hasSession: true, pending: 2, lastError: true }), SYNC.ERROR);
});

test('SYNCED requires a session, an empty queue and no error', () => {
  assert.equal(resolveSyncState({ hasSession: true, pending: 0, lastError: false }), SYNC.SYNCED);
});

test('defect 1 reproduced: a later success cannot mask an earlier failure', () => {
  // Grade one item, the write fails, it stays queued. Grade a second, that one
  // succeeds. Under the old code syncState would now read 'synced'. It cannot.
  const q = createQueue();
  queueWrite(q, 'RM-01', 'morning', patch());        // failed, still queued
  queueWrite(q, 'RM-02', 'morning', patch());
  clearWrite(q, 'RM-02', 'morning');                 // second one accepted

  assert.equal(pendingCount(q), 1, 'the first write is still outstanding');
  assert.notEqual(
    resolveSyncState({ hasSession: true, pending: pendingCount(q) }),
    SYNC.SYNCED,
    'the header must not claim SYNCED while a grade is unsaved',
  );
});

test('the label counts what is outstanding, so the number is visible', () => {
  assert.equal(syncLabel(SYNC.SYNCED).text, 'SYNCED');
  assert.equal(syncLabel(SYNC.PENDING, 3).text, 'SAVING 3');
  assert.equal(syncLabel(SYNC.ERROR, 2).text, 'UNSAVED 2');
  assert.equal(syncLabel(SYNC.SIGNED_OUT, 5).text, 'SIGNED OUT 5');
  assert.equal(syncLabel(SYNC.SIGNED_OUT, 0).text, 'SIGNED OUT');
});

test('every derived state has a label and none of them says SYNCED wrongly', () => {
  for (const state of [SYNC.PENDING, SYNC.ERROR, SYNC.SIGNED_OUT]) {
    assert.notEqual(syncLabel(state, 1).text, 'SYNCED');
  }
});

// ── the pull must not erase what has not been sent ──────────────────────────

test('a pending write survives a remote pull that does not know about it', () => {
  // The remote pull replaces local state with the server's rows. Without this,
  // an unsaved grade would be erased from the device too: a sync failure
  // becoming real data loss on the next reload.
  const remote = { 'RM-01': { morning: { status: 'met', note: null, time: '09:00', critical: false, naReason: null } } };
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', patch({ status: 'missed', time: '10:15' }));

  const merged = applyPending(remote, q);
  assert.equal(merged['RM-01'].morning.status, 'met', 'the server row is kept');
  assert.equal(merged['RM-02'].morning.status, 'missed', 'the unsaved grade is not erased');
});

test('a pending write wins over a stale server copy of the same cell', () => {
  const remote = { 'RM-01': { morning: { status: 'met', note: null, time: '09:00', critical: false, naReason: null } } };
  const q = createQueue();
  queueWrite(q, 'RM-01', 'morning', patch({ status: 'missed' }));

  assert.equal(applyPending(remote, q)['RM-01'].morning.status, 'missed');
});

test('merging carries note, critical and the N/A reason', () => {
  // Losing na_reason here would repeat the Phase 5.7 defect: a structural N/A
  // coming back reasonless is read as observational and re-enters scope.
  const q = createQueue();
  queueWrite(q, 'SP-01', 'day', patch({
    status: 'na', na_reason: 'not_present', note: 'No spa on site.', critical: true,
  }));

  const entry = applyPending({}, q)['SP-01'].day;
  assert.equal(entry.status, 'na');
  assert.equal(entry.naReason, 'not_present');
  assert.equal(entry.note, 'No spa on site.');
  assert.equal(entry.critical, true);
});

test('merging an empty queue changes nothing', () => {
  const remote = { 'RM-01': { morning: { status: 'met', note: null, time: '09:00', critical: false, naReason: null } } };
  assert.deepEqual(applyPending(remote, createQueue()), remote);
});

test('merging does not mutate the remote object it was given', () => {
  const remote = { 'RM-01': { morning: { status: 'met' } } };
  const q = createQueue();
  queueWrite(q, 'RM-01', 'morning', patch({ status: 'missed' }));
  applyPending(remote, q);
  assert.equal(remote['RM-01'].morning.status, 'met', 'the caller\'s copy is untouched');
});

// ── the whole failure and recovery, end to end ──────────────────────────────

test('a session that goes and comes back leaves nothing behind', () => {
  const q = createQueue();

  // Signed in, one grade lands.
  queueWrite(q, 'RM-01', 'morning', patch());
  clearWrite(q, 'RM-01', 'morning');
  assert.equal(resolveSyncState({ hasSession: true, pending: pendingCount(q) }), SYNC.SYNCED);

  // Session expires. Two more grades are made and cannot be sent.
  queueWrite(q, 'RM-02', 'morning', patch({ status: 'partial' }));
  queueWrite(q, 'RM-03', 'morning', patch({ status: 'missed' }));
  assert.equal(resolveSyncState({ hasSession: false, pending: pendingCount(q) }), SYNC.SIGNED_OUT);
  assert.equal(pendingCount(q), 2, 'both grades are still held');

  // Signed back in, before the flush runs.
  assert.equal(resolveSyncState({ hasSession: true, pending: pendingCount(q) }), SYNC.PENDING);

  // The flush drains the queue in order.
  for (const e of pendingEntries(q)) clearWrite(q, e.itemId, e.shiftId);
  assert.equal(resolveSyncState({ hasSession: true, pending: pendingCount(q) }), SYNC.SYNCED);
});
