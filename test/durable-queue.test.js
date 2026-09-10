// Phase 6.4 — the pending write queue must survive a reload, not just a slow
// network. Phase 6.1 fixed how the queue behaves while the app is open; this
// is what makes "while the app is open" stop being the whole guarantee.
//
// The defect this closes: pendingRef is a useRef, reset empty by any reload.
// The remote-pull effect (App.jsx, "once signed in... pull the latest remote
// copy") then reapplies that empty queue over whatever the server returns —
// and reapplying nothing changes nothing, so a grade that had not yet reached
// the server was silently replaced by the server's older copy. No REFUSED, no
// error, no trace. serializeQueue/deserializeQueue exist so pendingRef can be
// repopulated before that effect ever runs.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQueue, queueWrite, clearWrite, markFailure, pendingCount,
  sendableEntries, blockedEntries, blockedCount, resolveSyncState, syncLabel,
  applyPending, isPermanentError,
  QUEUE_STORAGE_VERSION, serializeQueue, deserializeQueue,
} from '../src/framework/syncQueue.js';
import { publishBlockers, canPublish } from '../src/framework/publishSafety.js';
import { dirtyCaptions, applyDirtyCaptions } from '../src/framework/photoEvidence.js';

const patch = (over = {}) => ({
  status: 'met', time: '09:00', note: null, critical: false,
  na_reason: null, na_note: null, ...over,
});

const RLS     = { code: '42501', message: 'new row violates row-level security policy for table "audit_items"' };
const FK      = { code: '23503', message: 'insert or update on table "audit_items" violates foreign key constraint' };
const NETWORK = { message: 'Failed to fetch' };
const TIMEOUT = (() => { const e = new Error('too slow'); e.code = 'TIMEOUT'; e.timeout = true; return e; })();

const AUDIT_A = 'audit-aaaa';
const AUDIT_B = 'audit-bbbb';

/** Round-trip a queue through the exact shape localStorage would hold. */
function reload(queue, auditId) {
  const json = JSON.parse(JSON.stringify(serializeQueue(queue, auditId)));
  return deserializeQueue(json);
}

// ── 1–2: survives a refresh ─────────────────────────────────────────────────

test('1. a pending write survives a refresh', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());

  const { queue: restored, auditId } = reload(q, AUDIT_A);

  assert.equal(pendingCount(restored), 1);
  assert.equal(auditId, AUDIT_A);
  assert.equal(sendableEntries(restored)[0].patch.status, 'met');
});

test('2. multiple pending writes survive a refresh, in the order they were made', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch({ status: 'met' }));
  queueWrite(q, 'RM-02', 'day', patch({ status: 'missed' }));
  queueWrite(q, 'RM-03', 'night', patch({ status: 'partial' }));

  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(pendingCount(restored), 3);
  assert.deepEqual(
    sendableEntries(restored).map((e) => e.itemId),
    ['RM-01', 'RM-02', 'RM-03'],
  );
});

// ── 3: success clears the durable record ────────────────────────────────────

test('3. a write the server has taken is removed from durable storage', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  queueWrite(q, 'RM-02', 'day', patch());

  // The server accepted RM-01. clearWrite is the one point, in flushPending,
  // at which a write stops being outstanding — this models what happens
  // immediately after, when the queue is persisted again.
  clearWrite(q, 'RM-01', 'day');
  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(pendingCount(restored), 1, 'only the unsent one remains');
  assert.equal(sendableEntries(restored)[0].itemId, 'RM-02');
});

// ── 4–5: transient failures remain durable and retryable ───────────────────

test('4. a timeout remains durable and sendable after a refresh', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  markFailure(q, 'RM-01', 'day', TIMEOUT);

  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(pendingCount(restored), 1);
  assert.equal(blockedCount(restored), 0, 'a timeout is transient, not permanent');
  assert.equal(sendableEntries(restored).length, 1, 'and is retried');
});

test('5. a transient network failure survives a refresh with its grade intact', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch({ status: 'missed', note: 'no hot water' }));
  markFailure(q, 'RM-01', 'day', NETWORK);

  const { queue: restored } = reload(q, AUDIT_A);

  const entry = sendableEntries(restored)[0];
  assert.equal(entry.patch.status, 'missed');
  assert.equal(entry.patch.note, 'no hot water', 'the grade is not just present, it is unchanged');
  assert.equal(entry.attempts, 1);
});

// ── 6–7: permanent refusals remain durable and REFUSED ──────────────────────

test('6. a 42501 refusal survives a refresh as REFUSED, not retried', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  markFailure(q, 'RM-01', 'day', RLS);

  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(blockedCount(restored), 1);
  assert.equal(sendableEntries(restored).length, 0, 'never silently retried forever');
  assert.equal(blockedEntries(restored)[0].error.code, '42501');
  const state = resolveSyncState({ hasSession: true, pending: pendingCount(restored), blocked: blockedCount(restored) });
  assert.equal(syncLabel(state, pendingCount(restored), blockedCount(restored)).text, 'REFUSED 1');
});

test('7. a 23503 foreign-key failure survives a refresh as REFUSED', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  markFailure(q, 'RM-01', 'day', FK);

  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(blockedCount(restored), 1);
  assert.equal(blockedEntries(restored)[0].error.code, '23503');
});

// ── 8: the unknown-item protection is not undone by a reload ───────────────

test('8. an item the current catalogue does not recognise stays retained and refused', () => {
  const q = createQueue();
  queueWrite(q, 'GONE-99', 'day', patch());
  markFailure(q, 'GONE-99', 'day', {
    code: 'UNKNOWN_ITEM', permanent: true, message: 'GONE-99 is not in this version of the checklist.',
  });

  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(pendingCount(restored), 1, 'not silently dropped');
  assert.equal(blockedCount(restored), 1);
  assert.match(restored.get('GONE-99 day').error.message, /not in this version/);
});

// ── 9–10: idempotent ─────────────────────────────────────────────────────────

test('9. rehydrating the same envelope does not duplicate entries', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  const envelope = serializeQueue(q, AUDIT_A);

  const first = deserializeQueue(envelope).queue;
  const second = deserializeQueue(envelope).queue;

  assert.equal(pendingCount(first), 1);
  assert.equal(pendingCount(second), 1);
  // Deserializing twice from the same source produces two independent queues
  // of one entry each, never one queue of two — there is no shared mutable
  // state between calls for the same key to accumulate into.
  assert.deepEqual([...first.keys()], [...second.keys()]);
});

test('10. repeated reload/save cycles are stable', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  markFailure(q, 'RM-02', 'day', RLS); // never queued — proves markFailure alone is a no-op on a missing key
  queueWrite(q, 'RM-03', 'night', patch());

  let current = q;
  for (let i = 0; i < 5; i++) {
    const { queue } = reload(current, AUDIT_A);
    current = queue;
  }

  assert.equal(pendingCount(current), 2, 'five round trips change nothing');
  assert.deepEqual(sendableEntries(current).map((e) => e.itemId).sort(), ['RM-01', 'RM-03']);
});

// ── 11–12: isolation across audits ──────────────────────────────────────────
//
// App.jsx enforces this at the point of restoring: a durable envelope is only
// applied to pendingRef when its auditId matches the audit currently being
// loaded. What is tested here, at this layer, is the precondition that makes
// that guard meaningful — that the envelope for one audit and the envelope
// for another are two independent, non-overlapping records with nothing to
// accidentally merge.

test('11. two audits\' durable queues are independent records', () => {
  const qa = createQueue();
  queueWrite(qa, 'RM-01', 'day', patch({ status: 'missed' }));
  const qb = createQueue();
  queueWrite(qb, 'RM-01', 'day', patch({ status: 'met' }));

  const envelopeA = serializeQueue(qa, AUDIT_A);
  const envelopeB = serializeQueue(qb, AUDIT_B);

  assert.equal(envelopeA.auditId, AUDIT_A);
  assert.equal(envelopeB.auditId, AUDIT_B);
  assert.notEqual(envelopeA.entries[0].patch.status, envelopeB.entries[0].patch.status);
});

test('12. restoring audit A\'s envelope while audit B is open is refused by the auditId check', () => {
  // The guard App.jsx applies, expressed as the predicate it reduces to.
  const canApply = (envelopeAuditId, openAuditId) =>
    Boolean(envelopeAuditId && openAuditId && envelopeAuditId === openAuditId);

  const qa = createQueue();
  queueWrite(qa, 'RM-01', 'day', patch());
  const envelopeA = serializeQueue(qa, AUDIT_A);

  assert.equal(canApply(envelopeA.auditId, AUDIT_B), false, 'A\'s writes must not reach B');
  assert.equal(canApply(envelopeA.auditId, AUDIT_A), true, 'but do reach A, returned to later');
});

// ── 13–14: auth ──────────────────────────────────────────────────────────────

test('13. durability does not depend on a session existing', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  // serializeQueue/deserializeQueue take no session argument at all — a
  // signed-out device restores exactly as a signed-in one does. The state the
  // auditor sees while signed out is resolveSyncState's job, tested already
  // in sync-queue-recovery.test.js ("signed out still outranks everything").
  const { queue: restored } = reload(q, AUDIT_A);
  assert.equal(pendingCount(restored), 1);
  assert.equal(resolveSyncState({ hasSession: false, pending: pendingCount(restored) }), 'signed-out');
});

test('14. re-authenticating makes a restored write sendable again', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  const { queue: restored } = reload(q, AUDIT_A);

  // Nothing about the entry itself changes between signed-out and signed-in;
  // only whether flushPending is permitted to run does, and that gate lives
  // in App.jsx, not in the queue. sendableEntries has always returned it.
  assert.equal(resolveSyncState({ hasSession: false, pending: pendingCount(restored) }), 'signed-out');
  assert.equal(resolveSyncState({ hasSession: true, pending: pendingCount(restored) }), 'pending');
  assert.equal(sendableEntries(restored).length, 1);
});

// ── 15: no false SYNCED before hydration is considered ──────────────────────

test('15. a restored pending or blocked count can never resolve to SYNCED', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  markFailure(q, 'RM-02', 'day', RLS); // no-op, RM-02 was never queued — use a real one instead
  queueWrite(q, 'RM-02', 'day', patch());
  markFailure(q, 'RM-02', 'day', RLS);
  const { queue: restored } = reload(q, AUDIT_A);

  const state = resolveSyncState({
    hasSession: true, pending: pendingCount(restored), blocked: blockedCount(restored),
  });
  assert.notEqual(state, 'synced');
  assert.equal(state, 'blocked');
});

// ── 16–17: publish stays blocked by what the reload proves is unsettled ─────

test('16. publish is blocked after a reload when durable pending writes exist', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  const { queue: restored } = reload(q, AUDIT_A);

  const gate = publishBlockers({
    hasSession: true, hasAudit: true,
    pendingWrites: pendingCount(restored), blockedWrites: blockedCount(restored),
  });
  assert.equal(canPublish({ hasSession: true, hasAudit: true, pendingWrites: pendingCount(restored) }), false);
  assert.ok(gate.some((b) => b.id === 'pending_writes'));
});

test('17. publish is blocked after a reload when durable REFUSED writes exist', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  markFailure(q, 'RM-01', 'day', RLS);
  const { queue: restored } = reload(q, AUDIT_A);

  const gate = publishBlockers({
    hasSession: true, hasAudit: true,
    pendingWrites: pendingCount(restored), blockedWrites: blockedCount(restored),
  });
  assert.ok(gate.some((b) => b.id === 'refused_writes'),
    'a reload must not let REFUSED work quietly become publishable');
});

test('a reload with an empty settled queue is the only case that publishes cleanly', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  clearWrite(q, 'RM-01', 'day'); // the server took it before the reload
  const { queue: restored } = reload(q, AUDIT_A);

  assert.equal(canPublish({
    hasSession: true, hasAudit: true,
    pendingWrites: pendingCount(restored), blockedWrites: blockedCount(restored),
  }), true);
});

// ── 18: malformed durable data cannot crash the app or take good data with it ─

test('18a. a malformed envelope is ignored, not thrown', () => {
  assert.doesNotThrow(() => deserializeQueue(undefined));
  assert.doesNotThrow(() => deserializeQueue(null));
  assert.doesNotThrow(() => deserializeQueue('not an object'));
  assert.doesNotThrow(() => deserializeQueue(42));
  assert.doesNotThrow(() => deserializeQueue({ v: QUEUE_STORAGE_VERSION })); // entries missing entirely
  assert.equal(pendingCount(deserializeQueue(undefined).queue), 0);
});

test('18b. one malformed entry is skipped without discarding the entries around it', () => {
  const raw = {
    v: QUEUE_STORAGE_VERSION,
    auditId: AUDIT_A,
    entries: [
      { itemId: 'RM-01', shiftId: 'day', patch: patch() },
      { itemId: 'RM-02' /* shiftId missing */, patch: patch() },
      null,
      { itemId: 'RM-03', shiftId: 'day', patch: patch({ status: 'missed' }) },
      { itemId: 'RM-04', shiftId: 'day' /* patch missing */ },
    ],
  };

  const { queue, skipped } = deserializeQueue(raw);

  assert.equal(pendingCount(queue), 2, 'RM-01 and RM-03 survive');
  assert.equal(skipped.length, 3, 'the other three are reported, not silent');
  assert.deepEqual([...queue.keys()].sort(), ['RM-01 day', 'RM-03 day']);
});

test('18c. an unrecognised version does not crash and restores nothing rather than something wrong', () => {
  const raw = { v: 999, auditId: AUDIT_A, entries: [{ itemId: 'RM-01', shiftId: 'day', patch: patch() }] };
  const { queue, skipped } = deserializeQueue(raw);
  assert.equal(pendingCount(queue), 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /unrecognised envelope/);
});

// ── versioned envelope ───────────────────────────────────────────────────────

test('the envelope carries its own version and audit id', () => {
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch());
  const envelope = serializeQueue(q, AUDIT_A);
  assert.equal(envelope.v, QUEUE_STORAGE_VERSION);
  assert.equal(envelope.auditId, AUDIT_A);
  assert.ok(typeof envelope.savedAt === 'string' && envelope.savedAt.length > 0);
});

// ── end to end: the real field scenario ─────────────────────────────────────

test('e2e: grade, lose connection, close the app, reopen, reconnect, publish only once settled', () => {
  // The auditor grades several items.
  const q = createQueue();
  queueWrite(q, 'RM-01', 'day', patch({ status: 'met' }));
  queueWrite(q, 'RM-02', 'day', patch({ status: 'missed', note: 'stained carpet' }));
  queueWrite(q, 'RM-03', 'night', patch({ status: 'partial' }));

  // The connection fails mid-flush. RM-01 got out; the rest did not.
  clearWrite(q, 'RM-01', 'day');
  markFailure(q, 'RM-02', 'day', NETWORK);
  // RM-03 was never attempted — the loop stopped at the first transient
  // failure, exactly as flushPending's own comment describes.

  assert.equal(pendingCount(q), 2, 'two grades are still outstanding');

  // The device is closed. This is what makes it to disk.
  const onDisk = serializeQueue(q, AUDIT_A);
  assert.equal(onDisk.entries.length, 2);

  // The app reopens. The queue is restored before the remote pull can run.
  const { queue: restored, auditId } = deserializeQueue(onDisk);
  assert.equal(auditId, AUDIT_A);
  assert.equal(pendingCount(restored), 2, 'nothing was lost by closing the app');

  // What the server holds at this moment does not include RM-02 or RM-03 —
  // applyPending is what stops that gap from erasing them on screen.
  const serverRows = { 'RM-01': { day: { status: 'met', naReason: null, naNote: null } } };
  const merged = applyPending(serverRows, restored);
  assert.equal(merged['RM-01'].day.status, 'met', 'the server copy is kept where it agrees');
  assert.equal(merged['RM-02'].day.status, 'missed', 'the unsent grade is not overwritten by its absence');
  assert.equal(merged['RM-03'].night.status, 'partial');

  // Publishing now must be refused: two grades are not on the server yet.
  assert.equal(canPublish({
    hasSession: true, hasAudit: true, pendingWrites: pendingCount(restored),
  }), false);

  // Connectivity returns. Both outstanding writes now succeed.
  clearWrite(restored, 'RM-02', 'day');
  clearWrite(restored, 'RM-03', 'night');
  assert.equal(pendingCount(restored), 0);

  // Only now, with the queue genuinely empty and the server holding every
  // grade, is the audit honestly publishable.
  assert.equal(canPublish({ hasSession: true, hasAudit: true, pendingWrites: pendingCount(restored) }), true);
  const state = resolveSyncState({ hasSession: true, pending: pendingCount(restored), blocked: blockedCount(restored) });
  assert.equal(state, 'synced');
});

// ── photo captions (the one other durable thing this phase adds) ───────────
//
// Not the photo — the photo is a Blob and stays exactly where it already was,
// in-memory only. A caption is text, keyed to a photo that already has a
// server id, and that is small enough to durable the same way a grade is.

test('a dirty caption on a saved photo is captured for durability', () => {
  const photos = {
    'RM-01 day': [
      { remote: { id: 'photo-1' }, note: 'chipped tile', noteDirty: true, status: 'saved' },
      { remote: { id: 'photo-2' }, note: 'fine', noteDirty: false, status: 'saved' },
      { remote: null, note: 'not uploaded yet', noteDirty: true, status: 'ready' },
    ],
  };
  const dirty = dirtyCaptions(photos);
  assert.deepEqual(dirty, [{ photoId: 'photo-1', note: 'chipped tile' }]);
});

test('a restored caption is laid back over the photo the server returns', () => {
  const fromServer = {
    'RM-01 day': [
      { remote: { id: 'photo-1' }, note: null, noteDirty: false, status: 'saved' },
    ],
  };
  const restored = applyDirtyCaptions(fromServer, [{ photoId: 'photo-1', note: 'chipped tile' }]);
  assert.equal(restored['RM-01 day'][0].note, 'chipped tile');
  assert.equal(restored['RM-01 day'][0].noteDirty, true, 'stays dirty until it actually commits');
});

test('no dirty captions leaves the loaded photo list untouched', () => {
  const fromServer = { 'RM-01 day': [{ remote: { id: 'photo-1' }, note: 'x', noteDirty: false }] };
  assert.equal(applyDirtyCaptions(fromServer, []), fromServer, 'same reference, nothing rebuilt for no reason');
});
