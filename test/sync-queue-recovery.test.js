// Phase 6.1 — the queue must never be stuck, and must never lie about why.
//
// The read-only investigation found two independent permanent stalls, both
// reachable with a valid session and a working network:
//
//   1. supabase-js is fetch underneath and fetch has no timeout. A hung
//      request never settled, so the finally that releases the flush lock
//      never ran, and every later retry returned immediately at the guard.
//      The header read SAVING 22 forever.
//
//   2. The flush loop broke on the first error. A Map preserves insertion
//      order and re-setting a key does not move it, so an entry the server
//      refuses permanently stayed at the head of the queue and the twenty-one
//      behind it were never attempted again. The header read UNSAVED 22
//      forever.
//
// Both were invisible because the error object was destructured for its
// truthiness and thrown away, so an RLS refusal and a dropped connection were
// indistinguishable to the app and to the auditor.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC, WRITE_TIMEOUT_MS, PERMANENT_ERROR_CODES,
  createQueue, queueWrite, clearWrite, markFailure,
  pendingCount, pendingEntries, sendableEntries, blockedEntries, blockedCount,
  blockedReasons, blockedMessage, isPermanentError, describeError,
  resolveSyncState, syncLabel, withTimeout, isTimeoutError, applyPending,
} from '../src/framework/syncQueue.js';

const patch = (over = {}) => ({
  status: 'met', time: '09:00', note: null, critical: false,
  na_reason: null, na_note: null, ...over,
});

/** The shapes PostgREST actually returns. */
const RLS      = { code: '42501', message: 'new row violates row-level security policy for table "audit_items"' };
const FK       = { code: '23503', message: 'insert or update on table "audit_items" violates foreign key constraint' };
const NETWORK  = { message: 'Failed to fetch' };
const NOTNULL  = { code: '23502', message: 'null value in column "label" violates not-null constraint' };

/** A queue of n grades, as 22 items in one section would arrive. */
const queueOf = (n, from = 1) => {
  const q = createQueue();
  for (let i = from; i < from + n; i++) queueWrite(q, `RM-${String(i).padStart(2, '0')}`, 'day', patch());
  return q;
};

// ── hung request recovery ───────────────────────────────────────────────────

test('a request that never settles is abandoned rather than hanging forever', async () => {
  // Defect 1, reproduced. Without withTimeout this promise never resolves and
  // the caller's finally never runs.
  const never = () => new Promise(() => {});
  await assert.rejects(
    () => withTimeout(never, { timeoutMs: 30 }),
    (e) => isTimeoutError(e) && e.code === 'TIMEOUT',
  );
});

test('the timeout aborts the underlying request, not just the promise', async () => {
  let aborted = false;
  await assert.rejects(
    () => withTimeout(() => new Promise(() => {}), { timeoutMs: 20, onTimeout: () => { aborted = true; } }),
    (e) => e.code === 'TIMEOUT',
  );
  assert.equal(aborted, true, 'the socket is not left hanging');
});

test('the lock is released after a hung request, so the next retry runs', async () => {
  // The whole point: a flush that times out must leave flushing false.
  let flushing = false;
  const flush = async () => {
    if (flushing) return 'skipped';
    flushing = true;
    try {
      await withTimeout(() => new Promise(() => {}), { timeoutMs: 20 });
      return 'sent';
    } catch (e) {
      return 'failed';
    } finally {
      flushing = false;
    }
  };

  assert.equal(await flush(), 'failed');
  assert.equal(flushing, false, 'the lock is not stuck');
  assert.notEqual(await flush(), 'skipped', 'and a second attempt is not refused');
});

test('a timeout is transient, so the entry is retried rather than abandoned', () => {
  const q = queueOf(1);
  const err = new Error('too slow'); err.code = 'TIMEOUT'; err.timeout = true;
  markFailure(q, 'RM-01', 'day', err);

  assert.equal(isPermanentError(err), false);
  assert.equal(blockedCount(q), 0, 'a slow network never blocks a write');
  assert.equal(sendableEntries(q).length, 1, 'and it is tried again');
});

test('a successful call is unaffected by the timeout wrapper', async () => {
  const res = await withTimeout(async () => ({ error: null }), { timeoutMs: 1000 });
  assert.deepEqual(res, { error: null });
});

test('the write timeout is bounded and sane', () => {
  assert.equal(WRITE_TIMEOUT_MS, 20000);
  assert.ok(WRITE_TIMEOUT_MS > 0 && WRITE_TIMEOUT_MS <= 60000);
});

// ── one refusal must not block the other twenty-one ─────────────────────────

test('defect 2 reproduced: a permanently refused entry does not stop the queue', () => {
  const q = queueOf(22);                       // RM-01 .. RM-22
  assert.equal(pendingCount(q), 22);

  // The head entry is refused on grounds no retry can change.
  markFailure(q, 'RM-01', 'day', RLS);

  assert.equal(blockedCount(q), 1);
  assert.equal(sendableEntries(q).length, 21, 'the other 21 are still attempted');
  assert.equal(sendableEntries(q)[0].itemId, 'RM-02', 'and the flush starts past it');
});

test('the twenty-one behind a refusal actually drain', () => {
  const q = queueOf(22);
  markFailure(q, 'RM-01', 'day', RLS);
  for (const e of sendableEntries(q)) clearWrite(q, e.itemId, e.shiftId);

  assert.equal(pendingCount(q), 1, 'only the refused one is left');
  assert.equal(blockedCount(q), 1);
  assert.equal(pendingEntries(q)[0].itemId, 'RM-01');
});

test('a refused entry is retained, never discarded', () => {
  // Losing the auditor's grade would be worse than any stall.
  const q = queueOf(1);
  markFailure(q, 'RM-01', 'day', RLS);
  assert.equal(pendingCount(q), 1);
  assert.equal(pendingEntries(q)[0].patch.status, 'met', 'the grade itself survives');
});

test('a transient failure blocks nothing and keeps its place', () => {
  const q = queueOf(22);
  markFailure(q, 'RM-01', 'day', NETWORK);
  assert.equal(blockedCount(q), 0);
  assert.equal(sendableEntries(q).length, 22, 'everything is still sendable');
  assert.equal(sendableEntries(q)[0].itemId, 'RM-01', 'and order is preserved');
});

test('queue order is insertion order, and a re-set does not move an entry', () => {
  const q = queueOf(3);
  queueWrite(q, 'RM-01', 'day', patch({ status: 'missed' }));  // re-grade the head
  assert.deepEqual(pendingEntries(q).map(e => e.itemId), ['RM-01', 'RM-02', 'RM-03']);
  assert.equal(pendingEntries(q)[0].patch.status, 'missed', 'with the newest payload');
});

// ── error identity is captured, not thrown away ─────────────────────────────

test('RLS 42501 is recorded with its code and message', () => {
  const q = queueOf(1);
  markFailure(q, 'RM-01', 'day', RLS);
  const e = pendingEntries(q)[0];
  assert.equal(e.error.code, '42501');
  assert.match(e.error.message, /row-level security/);
  assert.equal(e.error.permanent, true);
  assert.equal(e.attempts, 1);
});

test('foreign key 23503 is recorded and permanent', () => {
  const q = queueOf(1);
  markFailure(q, 'RM-01', 'day', FK);
  assert.equal(pendingEntries(q)[0].error.code, '23503');
  assert.equal(blockedCount(q), 1);
});

test('every code known to be unfixable by retrying is treated as permanent', () => {
  for (const code of PERMANENT_ERROR_CODES) {
    assert.equal(isPermanentError({ code }), true, code);
  }
  assert.ok(PERMANENT_ERROR_CODES.includes('42501'));
  assert.ok(PERMANENT_ERROR_CODES.includes('23503'));
});

test('an unknown error is transient, which is the safe default', () => {
  // Retrying costs time. Giving up on a recoverable write costs evidence.
  assert.equal(isPermanentError(NETWORK), false);
  assert.equal(isPermanentError({ code: '08006', message: 'connection failure' }), false);
  assert.equal(isPermanentError(null), false);
  assert.equal(isPermanentError(undefined), false);
});

test('attempts accumulate across retries of the same entry', () => {
  const q = queueOf(1);
  markFailure(q, 'RM-01', 'day', NETWORK);
  markFailure(q, 'RM-01', 'day', NETWORK);
  markFailure(q, 'RM-01', 'day', NETWORK);
  assert.equal(pendingEntries(q)[0].attempts, 3);
});

test('describeError keeps everything worth reporting and nothing else', () => {
  const d = describeError({ code: '42501', message: 'm', details: 'd', hint: 'h' });
  assert.deepEqual(Object.keys(d).sort(), ['at', 'code', 'details', 'hint', 'message', 'permanent']);
  assert.equal(d.permanent, true);
});

// ── the unknown item id is refused, not silently dropped ────────────────────

test('an item id the catalogue no longer knows is refused, not discarded', () => {
  // Before this it was cleared from the queue with no error and no notice,
  // which quietly lost a grade the auditor had made.
  const q = createQueue();
  queueWrite(q, 'GONE-99', 'day', patch());
  markFailure(q, 'GONE-99', 'day', {
    code: 'UNKNOWN_ITEM', permanent: true, message: 'GONE-99 is not in this version of the checklist.',
  });

  assert.equal(pendingCount(q), 1, 'the write is still there');
  assert.equal(blockedCount(q), 1, 'and it is reported');
  assert.match(blockedReasons(q)[0].message, /not in this version/);
});

// ── no false SYNCED or SAVING ───────────────────────────────────────────────

test('a refused queue never reads as SYNCED', () => {
  const state = resolveSyncState({ hasSession: true, pending: 22, blocked: 1 });
  assert.notEqual(state, SYNC.SYNCED);
  assert.equal(state, SYNC.BLOCKED);
});

test('a refused queue never reads as SAVING either', () => {
  // The specific lie: SAVING implies the app is still trying. It is not.
  const state = resolveSyncState({ hasSession: true, pending: 22, blocked: 22, lastError: false });
  assert.notEqual(state, SYNC.PENDING);
  assert.equal(syncLabel(state, 22, 22).text, 'REFUSED 22');
  assert.equal(syncLabel(state, 22, 22).tone, 'bad');
});

test('blocked outranks a transient error, which outranks pending', () => {
  assert.equal(resolveSyncState({ hasSession: true, pending: 5, lastError: true, blocked: 2 }), SYNC.BLOCKED);
  assert.equal(resolveSyncState({ hasSession: true, pending: 5, lastError: true, blocked: 0 }), SYNC.ERROR);
  assert.equal(resolveSyncState({ hasSession: true, pending: 5, lastError: false, blocked: 0 }), SYNC.PENDING);
});

test('signed out still outranks everything', () => {
  assert.equal(resolveSyncState({ hasSession: false, pending: 22, blocked: 22 }), SYNC.SIGNED_OUT);
});

test('SYNCED still requires an empty queue, nothing blocked, and no error', () => {
  assert.equal(resolveSyncState({ hasSession: true, pending: 0, blocked: 0, lastError: false }), SYNC.SYNCED);
});

test('the existing states are unchanged for callers that pass no blocked count', () => {
  // Backward compatibility with every existing call site and test.
  assert.equal(resolveSyncState({ hasSession: true, pending: 0 }), SYNC.SYNCED);
  assert.equal(resolveSyncState({ hasSession: true, pending: 3 }), SYNC.PENDING);
  assert.equal(resolveSyncState({ hasSession: true, pending: 3, lastError: true }), SYNC.ERROR);
});

// ── what the auditor is told ────────────────────────────────────────────────

test('an RLS refusal is explained in the auditor\'s terms, with a remedy', () => {
  const q = queueOf(22);
  for (const e of pendingEntries(q)) markFailure(q, e.itemId, e.shiftId, RLS);
  const msg = blockedMessage(blockedReasons(q));

  assert.match(msg, /22 changes/);
  assert.match(msg, /belongs to another auditor/);
  assert.match(msg, /still on this device/, 'and it says the work is not lost');
  assert.equal(/row-level security/.test(msg), false, 'without the database jargon');
});

test('a missing audit is explained differently, because the remedy differs', () => {
  const q = queueOf(3);
  for (const e of pendingEntries(q)) markFailure(q, e.itemId, e.shiftId, FK);
  const msg = blockedMessage(blockedReasons(q));
  assert.match(msg, /no longer exists/);
  assert.match(msg, /Do not close the app/);
});

test('an unrecognised refusal still reports the real message', () => {
  const q = queueOf(1);
  markFailure(q, 'RM-01', 'day', NOTNULL);
  const msg = blockedMessage(blockedReasons(q));
  assert.match(msg, /not-null constraint/, 'the truth, even when it is jargon');
});

test('nothing blocked produces no message at all', () => {
  assert.equal(blockedMessage([]), null);
  assert.equal(blockedMessage(blockedReasons(queueOf(5))), null);
});

test('reasons are grouped, so twenty-two of one refusal is one message', () => {
  const q = queueOf(22);
  for (const e of pendingEntries(q)) markFailure(q, e.itemId, e.shiftId, RLS);
  const reasons = blockedReasons(q);
  assert.equal(reasons.length, 1, 'one reason');
  assert.equal(reasons[0].items.length, 22, 'covering all 22 items');
});

// ── recovery ────────────────────────────────────────────────────────────────

test('re-grading a refused item clears its block and tries again', () => {
  // The auditor's way out: change something, and it is a new write.
  const q = queueOf(1);
  markFailure(q, 'RM-01', 'day', RLS);
  assert.equal(blockedCount(q), 1);

  queueWrite(q, 'RM-01', 'day', patch({ status: 'missed' }));
  assert.equal(blockedCount(q), 0);
  assert.equal(sendableEntries(q).length, 1);
  assert.equal(pendingEntries(q)[0].error, null);
});

test('a transient failure then a success leaves the queue clean', () => {
  const q = queueOf(2);
  markFailure(q, 'RM-01', 'day', NETWORK);
  clearWrite(q, 'RM-01', 'day');
  clearWrite(q, 'RM-02', 'day');
  assert.equal(pendingCount(q), 0);
  assert.equal(resolveSyncState({ hasSession: true, pending: 0, blocked: 0 }), SYNC.SYNCED);
});

test('the full 22-item scenario ends honestly rather than stuck', () => {
  // One audit belonging to somebody else: every write refused, nothing lost,
  // nothing pretending to still be in flight.
  const q = queueOf(22);
  for (const e of sendableEntries(q)) markFailure(q, e.itemId, e.shiftId, RLS);

  assert.equal(pendingCount(q), 22, 'every grade is retained');
  assert.equal(blockedCount(q), 22);
  assert.equal(sendableEntries(q).length, 0, 'and none is retried pointlessly');

  const state = resolveSyncState({ hasSession: true, pending: 22, blocked: 22 });
  assert.equal(state, SYNC.BLOCKED);
  assert.equal(syncLabel(state, 22, 22).text, 'REFUSED 22');
  assert.match(blockedMessage(blockedReasons(q)), /another auditor/);
});

// ── Phase 6.2: Not Assessed through the queue ───────────────────────────────
//
// The new state is carried by two existing columns, na_reason and na_note, so
// it rides the queue exactly as a grade does. These assert that it actually
// does, because a state that reaches the screen and not the server is the
// failure this whole queue exists to make impossible.

const naPatch = (over = {}) => ({
  status: 'na', time: '09:00', note: null, critical: false,
  na_reason: 'not_observed', na_note: null, ...over,
});

test('Not Assessed queues and clears like any other write', () => {
  const q = createQueue();
  queueWrite(q, 'SP-01', 'day', naPatch({ na_note: 'Did not use the spa' }));
  assert.equal(pendingCount(q), 1);
  assert.equal(pendingEntries(q)[0].patch.na_reason, 'not_observed');
  assert.equal(pendingEntries(q)[0].patch.na_note, 'Did not use the spa');

  clearWrite(q, 'SP-01', 'day');
  assert.equal(resolveSyncState({ hasSession: true, pending: pendingCount(q) }), SYNC.SYNCED);
});

test('a temporary network failure does not lose the Not Assessed state', () => {
  const q = createQueue();
  queueWrite(q, 'SP-01', 'day', naPatch({ na_note: 'Restaurant not visited' }));
  markFailure(q, 'SP-01', 'day', NETWORK);

  assert.equal(pendingCount(q), 1, 'the write is retained');
  assert.equal(blockedCount(q), 0, 'and is not blocked');
  assert.equal(sendableEntries(q)[0].patch.na_note, 'Restaurant not visited',
    'with the explanation intact for the retry');
});

test('a permanent refusal of a Not Assessed write surfaces as REFUSED', () => {
  const q = createQueue();
  queueWrite(q, 'SP-01', 'day', naPatch());
  markFailure(q, 'SP-01', 'day', RLS);

  const state = resolveSyncState({ hasSession: true, pending: 1, blocked: blockedCount(q) });
  assert.equal(state, SYNC.BLOCKED);
  assert.equal(syncLabel(state, 1, 1).text, 'REFUSED 1');
  assert.match(blockedMessage(blockedReasons(q)), /another auditor/);
});

test('a pending Not Assessed write is reapplied over the server rows', () => {
  // applyPending must carry na_note as well as na_reason, or a reapplied write
  // would silently drop the auditor's explanation.
  const q = createQueue();
  queueWrite(q, 'SP-01', 'day', naPatch({ na_note: 'Pool not used' }));
  const merged = applyPending({}, q);

  assert.equal(merged['SP-01'].day.status, 'na');
  assert.equal(merged['SP-01'].day.naReason, 'not_observed');
  assert.equal(merged['SP-01'].day.naNote, 'Pool not used');
});

test('Not Assessed survives a pull that does not know about it yet', () => {
  const remote = { 'RM-01': { day: { status: 'met', naReason: null, naNote: null } } };
  const q = createQueue();
  queueWrite(q, 'SP-01', 'day', naPatch({ na_note: 'Gym not visited' }));

  const merged = applyPending(remote, q);
  assert.equal(merged['RM-01'].day.status, 'met', 'the server row is kept');
  assert.equal(merged['SP-01'].day.naNote, 'Gym not visited', 'and the unsaved state is not erased');
});
