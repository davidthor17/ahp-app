/**
 * Outstanding item writes, and the honest sync state that follows from them.
 *
 * Phase 5.8. Before this, a failed write to audit_items set syncState to
 * 'error' and was never attempted again. The grade lived on in localStorage
 * and in React state, so the auditor saw it on screen, but nothing on the
 * server held it. The next successful write of any other item set syncState
 * back to 'synced' and the failure disappeared from view. A lost session was
 * worse still: pushItem returned before touching syncState at all, so every
 * grade after the session expired went nowhere while the header carried on
 * reporting SYNCED from the last write that happened to succeed.
 *
 * Two things fix that, and both live here so they can be tested without a
 * browser or a database:
 *
 *   1. Every write is recorded as pending before it is attempted, and removed
 *      only when the server has accepted it. What is outstanding is therefore
 *      a fact about the queue rather than a memory of the last attempt.
 *   2. The displayed state is derived from that queue, not set by whichever
 *      code path ran last. Nothing can report SYNCED while work is
 *      outstanding, because SYNCED is only ever the answer when the queue is
 *      empty.
 *
 * This is a retry queue for writes the auditor has already made while the app
 * is open. It is not offline mode: it holds no session, survives no reload,
 * and promises nothing about working without a network.
 */

/** What the header may say. Derived, never assigned from an event. */
export const SYNC = Object.freeze({
  SYNCED: 'synced',
  PENDING: 'pending',
  ERROR: 'error',
  SIGNED_OUT: 'signed-out',
  // A write the server has refused on grounds that retrying cannot change.
  // Distinct from ERROR, which means "failed, will try again": BLOCKED means
  // "will never succeed as things stand, and somebody has to look at it".
  BLOCKED: 'blocked',
});

/**
 * How long one item write may take before it is abandoned.
 *
 * fetch has no default timeout. A captive portal or a half-open connection
 * leaves the promise pending forever, and the flush lock is released in a
 * finally that then never runs, so the queue is deadlocked with full apparent
 * connectivity. Twenty seconds is well beyond a slow hotel round trip and well
 * inside an auditor's patience.
 */
export const WRITE_TIMEOUT_MS = 20000;

/**
 * Postgres error codes that mean "this exact row will never be accepted".
 *
 *   42501  RLS refused it. The commonest real cause is an audit belonging to
 *          another auditor: internal reads all audits, but internal manages
 *          only its own audit items.
 *   23503  foreign key violation, e.g. the audit row is gone while this
 *          device still holds its id.
 *   23502  not null violation, 23514 check violation, 22P02 bad input.
 *   42P01  the table does not exist, i.e. the code is ahead of the migration.
 *   PGRST204  PostgREST could not find a column named in the payload.
 *
 * Anything not listed is treated as transient, which is the safe default: a
 * transient error is retried forever, and retrying costs nothing but time.
 */
export const PERMANENT_ERROR_CODES = Object.freeze([
  '42501', '23503', '23502', '23514', '22P02', '42P01', '42703', 'PGRST204',
]);

export function isPermanentError(error) {
  if (!error) return false;
  if (error.permanent === true) return true;
  return PERMANENT_ERROR_CODES.includes(String(error.code || ''));
}

/** Everything worth keeping about a refusal, so it can be reported. */
export function describeError(error) {
  if (!error) return null;
  return {
    code: error.code ? String(error.code) : null,
    message: error.message || String(error),
    details: error.details || null,
    hint: error.hint || null,
    permanent: isPermanentError(error),
    at: new Date().toISOString(),
  };
}

/**
 * One key per item and shift. A later edit to the same cell replaces the
 * earlier one rather than queueing behind it: the patch carries the whole row,
 * so the newest is the only one worth sending.
 */
export const writeKey = (itemId, shiftId) => `${itemId} ${shiftId}`;

/** A fresh queue. A Map, so insertion order is the order of the retry. */
export const createQueue = () => new Map();

export function queueWrite(queue, itemId, shiftId, patch) {
  const key = writeKey(itemId, shiftId);
  const existing = queue.get(key);
  // A re-edit of a blocked cell is a new attempt at it, not a repeat of the
  // old one: the auditor has changed something, so the refusal that applied to
  // the previous payload is cleared and it is tried again.
  queue.set(key, {
    itemId, shiftId, patch,
    attempts: existing ? existing.attempts || 0 : 0,
    error: null,
    blocked: false,
  });
  return queue;
}

export function clearWrite(queue, itemId, shiftId) {
  return queue.delete(writeKey(itemId, shiftId));
}

/**
 * Record a refusal against an entry, keeping it in the queue.
 *
 * The entry is never dropped. A permanent refusal marks it blocked so the
 * flush steps over it instead of stopping dead on it, and so the console can
 * say which item was refused and why. A transient one only counts the attempt.
 */
export function markFailure(queue, itemId, shiftId, error) {
  const key = writeKey(itemId, shiftId);
  const entry = queue.get(key);
  if (!entry) return queue;
  const described = describeError(error);
  queue.set(key, {
    ...entry,
    attempts: (entry.attempts || 0) + 1,
    error: described,
    blocked: Boolean(described && described.permanent),
  });
  return queue;
}

export const pendingCount = (queue) => queue.size;

/** Oldest first, so a retry sends things in the order they were graded. */
export const pendingEntries = (queue) => Array.from(queue.values());

/**
 * What a flush should attempt, in order: everything not already known to be
 * refused on permanent grounds.
 *
 * This is what stops one poisoned entry holding twenty-one good ones hostage.
 * Before it, the loop broke on the first error and the blocked entry stayed at
 * the head of the Map forever, so every later write was retried never.
 */
export const sendableEntries = (queue) => pendingEntries(queue).filter((e) => !e.blocked);

/** Entries the server has refused for good. Kept, surfaced, never discarded. */
export const blockedEntries = (queue) => pendingEntries(queue).filter((e) => e.blocked);

export const blockedCount = (queue) => blockedEntries(queue).length;

export const hasPending = (queue) => queue.size > 0;

/** The distinct reasons behind the blocked entries, for one honest message. */
export function blockedReasons(queue) {
  const seen = new Map();
  for (const e of blockedEntries(queue)) {
    if (!e.error) continue;
    const k = `${e.error.code || '?'} ${e.error.message}`;
    if (!seen.has(k)) seen.set(k, { ...e.error, items: [] });
    seen.get(k).items.push(e.itemId);
  }
  return Array.from(seen.values());
}

/**
 * The state to display, given everything that is true right now.
 *
 * Order matters. Signed out outranks the queue because a queue that cannot be
 * sent is not merely pending, and an error outranks plain pending because a
 * write that has already been refused should not look like one still on its
 * way. SYNCED is last and conditional: it is what is left when there is a
 * session, nothing is outstanding, and nothing has failed.
 */
export function resolveSyncState({ hasSession, pending = 0, lastError = false, blocked = 0 } = {}) {
  if (!hasSession) return SYNC.SIGNED_OUT;
  // Blocked outranks a plain error. A refusal that retrying cannot fix must
  // not sit behind a label that implies the app is still trying, which is
  // exactly how twenty-two writes stayed invisible behind one.
  if (blocked > 0) return SYNC.BLOCKED;
  if (lastError) return SYNC.ERROR;
  if (pending > 0) return SYNC.PENDING;
  return SYNC.SYNCED;
}

/** Short label and colour role for the header. */
export function syncLabel(state, pending = 0, blocked = 0) {
  switch (state) {
    case SYNC.SYNCED:      return { text: 'SYNCED', tone: 'ok' };
    case SYNC.PENDING:     return { text: pending > 0 ? `SAVING ${pending}` : 'SAVING', tone: 'busy' };
    case SYNC.ERROR:       return { text: pending > 0 ? `UNSAVED ${pending}` : 'SYNC ERROR', tone: 'bad' };
    case SYNC.SIGNED_OUT:  return { text: pending > 0 ? `SIGNED OUT ${pending}` : 'SIGNED OUT', tone: 'bad' };
    // Named REFUSED rather than blocked or failed: it is the server's answer,
    // not a state the app has got itself into, and it will not clear on its
    // own however long the auditor waits.
    case SYNC.BLOCKED:     return { text: blocked > 0 ? `REFUSED ${blocked}` : 'REFUSED', tone: 'bad' };
    default:               return { text: 'LOCAL', tone: 'muted' };
  }
}

/**
 * One sentence explaining a refusal, in the auditor's terms.
 *
 * 42501 gets its own wording because it has one overwhelmingly likely cause in
 * this app and a clear remedy, and "row level security policy" tells an
 * auditor standing in a hotel corridor nothing at all.
 */
export function blockedMessage(reasons = []) {
  if (!reasons.length) return null;
  const items = reasons.reduce((n, r) => n + (r.items ? r.items.length : 0), 0);
  const first = reasons[0];
  const scope = `${items} change${items === 1 ? '' : 's'}`;
  if (first.code === '42501') {
    return `${scope} were refused because this audit belongs to another auditor. Your grades are still on this device. Ask them to publish it, or start your own audit for this property.`;
  }
  if (first.code === '23503') {
    return `${scope} were refused because this audit no longer exists in Specula. Your grades are still on this device. Do not close the app.`;
  }
  return `${scope} were refused by Specula and will not be retried: ${first.message}`;
}

/**
 * Put outstanding writes back on top of a set of rows that came from the
 * server.
 *
 * The remote pull replaces local state with what the database holds. If a
 * grade never reached the database, replacing would erase it from the device
 * as well, turning a sync failure into real data loss. Reapplying the queue
 * afterwards keeps the auditor's most recent intent on screen and in the
 * queue, where the retry will find it.
 *
 * The patch is in row shape, because that is what goes to PostgREST. The audit
 * map is in entry shape. This is the one place the two meet.
 */
export function applyPending(remoteAudit = {}, queue = new Map()) {
  const merged = { ...remoteAudit };
  for (const { itemId, shiftId, patch } of pendingEntries(queue)) {
    const byShift = { ...(merged[itemId] || {}) };
    byShift[shiftId] = {
      status:   patch.status ?? null,
      note:     patch.note ?? null,
      time:     patch.time ?? null,
      critical: !!patch.critical,
      naReason: patch.na_reason ?? null,
      // Carried for the same reason na_reason is: a pending write reapplied
      // over the server's rows must not silently drop the auditor's
      // explanation of why an item was not experienced.
      naNote: patch.na_note ?? null,
    };
    merged[itemId] = byShift;
  }
  return merged;
}

/**
 * Run a request with a bounded lifetime.
 *
 * The defect this exists for: supabase-js is fetch underneath, fetch has no
 * default timeout, and the flush lock is released in a finally clause. A
 * request that never settles therefore never releases the lock, and every
 * later retry returns immediately at the guard. The queue deadlocks with the
 * network apparently fine and the header reading SAVING forever.
 *
 * Two layers on purpose. `signal` lets the caller abort the real request so
 * the socket is not left hanging; the race guarantees this promise settles
 * even if the transport ignores the abort. Only the second is load-bearing.
 */
export function withTimeout(run, { timeoutMs = WRITE_TIMEOUT_MS, onTimeout = null } = {}) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) { try { onTimeout(); } catch (e) { /* aborting is best effort */ } }
      const err = new Error(`The request took longer than ${Math.round(timeoutMs / 1000)} seconds.`);
      err.code = 'TIMEOUT';
      err.timeout = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(run), timeout])
    .finally(() => { if (timer) clearTimeout(timer); });
}

/** A timeout is transient: the connection was bad, not the row. */
export const isTimeoutError = (error) => Boolean(error && (error.timeout || error.code === 'TIMEOUT'));

// ── durability (Phase 6.4) ───────────────────────────────────────────────────
//
// Everything above this line answers "what is outstanding right now" for an
// app that is open. None of it survives a reload: pendingRef is a useRef, and
// a useRef is exactly as durable as the tab. Before this, a refresh with
// unsaved grades did not just forget they were outstanding — the next remote
// pull (App.jsx, "once signed in... pull the latest remote copy") reapplies
// the queue over the server's rows, and reapplying an empty queue reapplies
// nothing. The grade the auditor made was silently replaced by the server's
// older copy, with no REFUSED, no error, nothing to see. That is the defect
// this exists to close.
//
// The fix is not a second queue. It is a way to write the one queue above to
// disk and read it back, so pendingRef can be repopulated before that pull
// effect ever runs. Everything about retrying, refusing and reporting stays
// exactly as it already is; only where the Map's contents live between page
// loads changes.

/** Bump when the durable shape changes. A record from an older version is
 * never assumed to still mean the same thing — see deserializeQueue. */
export const QUEUE_STORAGE_VERSION = 1;

/**
 * The queue, as JSON.
 *
 * itemId and shiftId travel with each entry rather than living only in the
 * Map key, so a key that fails to parse can never separate an entry from the
 * identity that makes it safe to retry. auditId travels with the envelope,
 * not each entry: every entry in one queue belongs to whichever audit was
 * open when it was made, and the caller is the one place that fact is known.
 */
export function serializeQueue(queue, auditId) {
  return {
    v: QUEUE_STORAGE_VERSION,
    auditId: auditId || null,
    savedAt: new Date().toISOString(),
    entries: pendingEntries(queue).map((e) => ({
      itemId: e.itemId,
      shiftId: e.shiftId,
      patch: e.patch,
      attempts: e.attempts || 0,
      error: e.error || null,
      blocked: !!e.blocked,
    })),
  };
}

/**
 * Rebuild a queue from its durable shape.
 *
 * Defensive per entry, not per envelope. This is the same rule Phase 6.1
 * already applies to a write the server refuses: one bad record must never be
 * a reason to lose every good one around it. An envelope this does not
 * recognise — wrong version, wrong shape, not there at all — restores as an
 * empty queue rather than throwing, because a durability layer that can crash
 * the app on its own saved data is worse than not having one.
 *
 * Returns what was skipped and why, so a caller can log it. Nothing here
 * decides that is worth telling the auditor; a queue that came back with one
 * fewer entry than expected is a diagnostic, not an incident.
 */
export function deserializeQueue(raw) {
  const skipped = [];
  const queue = createQueue();

  if (!raw || typeof raw !== 'object') {
    return { queue, auditId: null, skipped };
  }
  if (raw.v !== QUEUE_STORAGE_VERSION || !Array.isArray(raw.entries)) {
    skipped.push({ reason: `unrecognised envelope (v=${raw.v})` });
    return { queue, auditId: (typeof raw.auditId === 'string' && raw.auditId) || null, skipped };
  }

  for (const entry of raw.entries) {
    try {
      if (!entry || typeof entry !== 'object') throw new Error('entry is not an object');
      const { itemId, shiftId, patch } = entry;
      if (typeof itemId !== 'string' || !itemId) throw new Error('missing itemId');
      if (typeof shiftId !== 'string' || !shiftId) throw new Error('missing shiftId');
      if (!patch || typeof patch !== 'object') throw new Error('missing patch');
      queue.set(writeKey(itemId, shiftId), {
        itemId,
        shiftId,
        patch,
        attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
        error: entry.error && typeof entry.error === 'object' ? entry.error : null,
        blocked: !!entry.blocked,
      });
    } catch (e) {
      skipped.push({ reason: e.message, entry });
    }
  }

  return { queue, auditId: (typeof raw.auditId === 'string' && raw.auditId) || null, skipped };
}
