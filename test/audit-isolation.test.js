// Phase 7.3 — one audit's work never reaches another.
//
// The console holds an audit's working state in a dozen pieces of React state.
// Three load paths each replaced some of them and none replaced all, so the
// leftovers followed the auditor into the next audit. Four of those leftovers
// are published: the summary typed for another hotel, a tier a draft row does
// not carry, an acknowledgement given for a different audit, and evidence that
// uploads against whichever audit id is current when it finally sends.
//
// There was also no way to begin a second audit at all. ensureRemoteAudit
// reuses ids.auditId whenever one exists and nothing cleared it, so the only
// route a field auditor would find after publishing was Edit, change the
// property, BEGIN AUDIT: the next hotel's grades on the last hotel's audit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditScopedReset, AUDIT_SCOPED_KEYS, tierForAudit, AUDIT_TIERS, DEFAULT_TIER,
  startAuditBlockers, canStartNewAudit, startAuditMessage, START_BLOCKER,
  newAuditIds, isNewAuditIdentity, mergeDeviceState,
} from '../src/framework/auditSession.js';
import {
  createQueue, queueWrite, markForeignEntries, entryBelongsTo, sendableEntries,
  blockedEntries, blockedCount, blockedReasons, blockedMessage, pendingCount,
  markFailure, unknownItemError, resolveSyncState, syncLabel, SYNC,
  serializeQueue, deserializeQueue, clearWrite, FOREIGN_ENTRY_CODE, UNKNOWN_ITEM_CODE,
} from '../src/framework/syncQueue.js';
import { PHOTO_STATUS, totalUnsaved, dirtyCaptions } from '../src/framework/photoEvidence.js';
import { publishBlockers, BLOCKER } from '../src/framework/publishSafety.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');

const AUDIT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const AUDIT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const photo = (over = {}) => ({
  localId: 'l1', photoId: 'p1', itemId: 'RM-02', shiftId: 'morning',
  status: PHOTO_STATUS.READY, note: null, noteDirty: false, remote: null, ...over,
});

// The state of a session that has been working on audit A for a while.
const workedOnA = () => ({
  photos: { 'RM-02 morning': [photo()] },
  pendingCaptions: [{ photoId: 'server-photo-1', note: 'Stained grout, A' }],
  summaryDraft: 'A calm, well run house in Reykjavik.',
  legacyAck: true,
  auditTier: 'spot',
  publishState: 'published',
  publishReason: 'already-published',
  publication: { published: true, publishedAt: '2026-09-01T00:00:00.000Z', percent: 81 },
  publicToken: '3f2a9c1e-7b4d-4e8a-9c0f-1d2e3f4a5b6c',
  clientReportMeta: { auditedOn: '2026-09-01', status: 'published' },
  naPrompt: 'RM-02', openNotes: { 'RM-02': true }, focusItemId: 'RM-02', sectionReturn: 'finish',
  photoOpen: 'RM-02', photoNotice: 'That caption could not be saved.', lightbox: { url: 'blob:x' },
});

// ── A to E: nothing audit-scoped survives the switch ────────────────────────

test('A. photos do not cross audit ids', () => {
  const before = workedOnA();
  assert.equal(totalUnsaved(before.photos), 1, 'audit A really does have an unsent photo');
  const after = auditScopedReset({ tier: 'full' });
  assert.deepEqual(after.photos, {});
  assert.equal(totalUnsaved(after.photos), 0, 'audit B starts with no evidence of its own');
});

test('B. the auditor summary does not cross audit ids', () => {
  assert.notEqual(workedOnA().summaryDraft, '');
  assert.equal(auditScopedReset({ tier: 'full' }).summaryDraft, '',
    'the summary typed for one hotel must never be frozen into another\'s report');
});

test('C. the tier does not cross audit ids, and a draft row falls back to Full', () => {
  assert.equal(workedOnA().auditTier, 'spot');
  // The real defect: a draft row carries no tier, so the old code kept the
  // previous audit's. The tier decides whether the Specula Mark is issued.
  assert.equal(auditScopedReset({ tier: null }).auditTier, 'full');
  assert.equal(auditScopedReset({ tier: undefined }).auditTier, 'full');
  assert.equal(auditScopedReset({ tier: 'desk' }).auditTier, 'desk');
  assert.equal(tierForAudit('spot'), 'spot');
  assert.equal(tierForAudit('nonsense'), DEFAULT_TIER, 'an unrecognised tier is never trusted');
  assert.deepEqual([...AUDIT_TIERS], ['desk', 'spot', 'full']);
});

test('D. the legacy acknowledgement does not cross audit ids', () => {
  assert.equal(workedOnA().legacyAck, true);
  assert.equal(auditScopedReset({}).legacyAck, false,
    'an acknowledgement given for one audit must not satisfy another\'s publish gate');
});

test('E. pending captions do not cross audit ids', () => {
  assert.equal(workedOnA().pendingCaptions.length, 1);
  assert.deepEqual(auditScopedReset({}).pendingCaptions, []);
});

test('the reset covers every audit-scoped field, publish memory included', () => {
  const fresh = auditScopedReset({});
  for (const key of AUDIT_SCOPED_KEYS) assert.ok(key in fresh, `${key} is missing`);
  assert.equal(fresh.publishState, 'idle');
  assert.equal(fresh.publishReason, null);
  assert.equal(fresh.publication, null);
  assert.equal(fresh.publicToken, null);
  assert.deepEqual(fresh.clientReportMeta, { auditedOn: null, status: 'draft' });
  assert.equal(fresh.naPrompt, null);
  assert.deepEqual(fresh.openNotes, {});
  assert.equal(fresh.focusItemId, null);
  assert.equal(fresh.sectionReturn, null);
  assert.equal(fresh.photoOpen, null);
  assert.equal(fresh.photoNotice, null);
  assert.equal(fresh.lightbox, null);
});

test('every path that changes which audit is open calls the reset', () => {
  // Four paths change which audit is open, and every one of them resets:
  // resume, a reviewer opening one, closing a reviewed one, and starting a new
  // one. The declaration itself does not match this pattern, so four is four.
  assert.equal((APP.match(/resetAuditScopedState\(/g) || []).length, 4,
    'called by every switch path, and by nothing else');
  assert.match(APP, /resetAuditScopedState\(\{ tier: auditRow && auditRow\.tier \}\)/, 'resume');
  assert.match(APP, /resetAuditScopedState\(\{ tier: row\.tier \}\)/, 'reviewer open');
  assert.match(APP, /setIds\(newAuditIds\(\)\);\s*\n\s*resetAuditScopedState\(\);/, 'closing a reviewed audit');
  assert.equal(/\['desk', 'spot', 'full'\]\.includes\(auditRow\.tier\)/.test(APP), false,
    'the old inline tier adopt, which kept the previous tier on a draft row, is gone');
});

// ── F: a grade can only be written to the audit it was made in ──────────────

test('F. a queue entry carries its audit and cannot flush to another', () => {
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', { status: 'missed' }, AUDIT_A);
  queueWrite(q, 'BTH-01', 'morning', { status: 'met' }, AUDIT_A);
  assert.equal(sendableEntries(q).length, 2, 'both are sendable to audit A');

  // The auditor is now in audit B. Nothing of A's may be written here.
  const marked = markForeignEntries(q, AUDIT_B);
  assert.equal(marked, 2);
  assert.equal(sendableEntries(q).length, 0, 'nothing is sent to audit B');
  assert.equal(pendingCount(q), 2, 'and nothing is discarded either');
  assert.equal(blockedCount(q), 2, 'they are refused, which is a state the UI shows');
  for (const e of blockedEntries(q)) {
    assert.equal(e.error.code, FOREIGN_ENTRY_CODE);
    assert.equal(e.error.permanent, true);
    assert.equal(e.auditId, AUDIT_A, 'the entry still knows where it belongs');
  }
  const message = blockedMessage(blockedReasons(q));
  assert.match(message, /different audit/);
  assert.equal(/42501|WRONG_AUDIT|policy|row level/.test(message), false, 'no database vocabulary');

  // Back in audit A, they are sendable again, because they always belonged here.
  queueWrite(q, 'RM-02', 'morning', { status: 'missed' }, AUDIT_A);
  assert.equal(markForeignEntries(q, AUDIT_A), 0);
  assert.equal(sendableEntries(q).some((e) => e.itemId === 'RM-02'), true);
});

test('a wrong-audit refusal is released on return, and a real refusal never is', () => {
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', { status: 'missed' }, AUDIT_A);
  queueWrite(q, 'BTH-01', 'morning', { status: 'met' }, AUDIT_A);
  // One of them was genuinely refused by the server, before any switching.
  markFailure(q, 'BTH-01', 'morning', { code: '42501', message: 'refused by policy' });

  markForeignEntries(q, AUDIT_B);
  assert.equal(blockedCount(q), 2, 'in audit B, neither may be written');
  assert.equal(blockedEntries(q).find((e) => e.itemId === 'BTH-01').error.code, '42501',
    'and the server\'s own answer is not overwritten by the switch');

  markForeignEntries(q, AUDIT_A);
  assert.deepEqual(sendableEntries(q).map((e) => e.itemId), ['RM-02'],
    'home again, so the grade that was only ever refused for being elsewhere may go');
  assert.equal(blockedCount(q), 1);
  assert.equal(blockedEntries(q)[0].itemId, 'BTH-01');
  assert.equal(blockedEntries(q)[0].error.code, '42501',
    'a round trip through another audit cannot clear a real refusal');
});

test('an entry with no audit id is treated as belonging here, so nothing pre-7.3 is stranded', () => {
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', { status: 'met' });
  assert.equal(entryBelongsTo(q.get('RM-02 morning'), AUDIT_A), true);
  assert.equal(markForeignEntries(q, AUDIT_A), 0);
});

test('a restored entry keeps its audit id, falling back to the envelope\'s', () => {
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', { status: 'met' }, AUDIT_A);
  const envelope = serializeQueue(q, AUDIT_A);
  assert.equal(envelope.entries[0].auditId, AUDIT_A, 'durable per entry, not only per envelope');

  const older = { ...envelope, entries: envelope.entries.map(({ auditId, ...rest }) => rest) };
  const { queue } = deserializeQueue(older);
  assert.equal(queue.get('RM-02 morning').auditId, AUDIT_A);
});

test('the flush refuses foreign entries before it sends anything', () => {
  assert.match(APP, /markForeignEntries\(pendingRef\.current, auditId\);/);
  const flush = APP.slice(APP.indexOf('const flushPending'), APP.indexOf('const pushItem'));
  assert.ok(flush.indexOf('markForeignEntries') < flush.indexOf('for (const'),
    'marked before the loop, not after a request has already gone');
  assert.match(APP, /queueWrite\(pendingRef\.current, itemId, shiftId, patch, auditId\)/,
    'and the entry is bound at the moment it is made');
});

// ── G: switching away and back restores only that audit's own state ─────────

test('G. A to B to A leaves B nothing of A\'s, and A nothing of B\'s', () => {
  // The queue is the one thing that legitimately survives, and it survives
  // bound to its own audit.
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', { status: 'missed' }, AUDIT_A);

  // → B. B's session starts blank, and A's entry is refused here.
  const inB = auditScopedReset({ tier: null });
  markForeignEntries(q, AUDIT_B);
  assert.deepEqual(inB.photos, {});
  assert.equal(inB.summaryDraft, '');
  assert.equal(inB.auditTier, 'full');
  assert.equal(sendableEntries(q).length, 0);

  // B does its own work.
  queueWrite(q, 'PRE-01', 'morning', { status: 'met' }, AUDIT_B);
  assert.deepEqual(sendableEntries(q).map((e) => e.itemId), ['PRE-01'], 'only B\'s own write is sendable in B');

  // → back to A. A's entry is sendable again; B's is now the foreign one.
  const backInA = auditScopedReset({ tier: 'spot' });
  markForeignEntries(q, AUDIT_A);
  assert.deepEqual(sendableEntries(q).map((e) => e.itemId), ['RM-02']);
  assert.equal(backInA.summaryDraft, '', 'A\'s summary is re-read from A, never remembered from before');
  assert.equal(backInA.auditTier, 'spot', 'A\'s own tier, from A\'s row');
  assert.deepEqual(backInA.photos, {}, 'and B\'s evidence did not come along');
});

// ── H: a published audit can never become the next one ──────────────────────

test('H. starting a new audit after publishing creates a new identity, and audit A is untouched', () => {
  // Audit A, published, exactly as the row and the console hold it.
  const publishedA = {
    ids: { propertyId: 'prop-a', auditId: AUDIT_A, auditRef: 'AHP-2026-AAAA' },
    row: {
      id: AUDIT_A, ref: 'AHP-2026-AAAA', status: 'published', property_id: 'prop-a',
      published_result: { formatVersion: 2, score: { percent: 81 } },
    },
  };
  const rowBefore = JSON.stringify(publishedA.row);

  const nextIds = newAuditIds();
  assert.equal(nextIds.auditId, null, 'no audit id to reuse, which is what makes the next one new');
  assert.equal(nextIds.propertyId, null, 'and no property id, so A\'s property row is not rewritten');
  assert.equal(nextIds.auditRef, null);
  assert.notEqual(nextIds.auditId, publishedA.ids.auditId);
  assert.equal(isNewAuditIdentity(publishedA.ids, nextIds), true);
  assert.equal(isNewAuditIdentity(publishedA.ids, publishedA.ids), false, 'reusing the id is not a new audit');

  // Nothing about A moved.
  assert.equal(JSON.stringify(publishedA.row), rowBefore);
  assert.equal(publishedA.row.status, 'published');
  assert.deepEqual(publishedA.row.published_result, { formatVersion: 2, score: { percent: 81 } });

  // And the published session state does not carry into the new audit.
  const fresh = auditScopedReset({});
  assert.equal(fresh.publication, null);
  assert.equal(fresh.publishState, 'idle');
  assert.equal(fresh.publicToken, null);
});

test('the console creates a row only when there is no audit id, so a cleared id is a new audit', () => {
  assert.match(APP, /let auditId = ids\.auditId;/);
  assert.match(APP, /if \(!auditId\) \{[\s\S]*?const ref = genAuditRef\(\);/);
  assert.match(APP, /let propertyId = ids\.propertyId;\s*\n\s*if \(!propertyId\) \{/);
  assert.match(APP, /const startNewAudit = useCallback/);
  assert.match(APP, /setIds\(nextIds\);\s*\n\s*resetAuditScopedState\(\);/, 'the new audit clears its ids and its state together');
});

test('starting a new audit is refused while anything is outstanding', () => {
  assert.equal(canStartNewAudit({}), true);
  assert.equal(canStartNewAudit({ pendingWrites: 1 }), false);
  assert.equal(canStartNewAudit({ blockedWrites: 1 }), false);
  assert.equal(canStartNewAudit({ unsavedPhotos: 1 }), false);

  // Refused outranks pending, which outranks photos: the same order the
  // publish gate uses, for the same reason.
  assert.deepEqual(
    startAuditBlockers({ pendingWrites: 2, blockedWrites: 3, unsavedPhotos: 1 }).map((b) => b.id),
    [START_BLOCKER.REFUSED_WRITES, START_BLOCKER.PENDING_WRITES, START_BLOCKER.UNSAVED_PHOTOS],
  );
  for (const blocker of startAuditBlockers({ pendingWrites: 1, blockedWrites: 1, unsavedPhotos: 1 })) {
    const message = startAuditMessage(blocker);
    assert.ok(message && message.length > 20, `${blocker.id} needs a real sentence`);
    assert.equal(/42501|RLS|policy|postgres|supabase/i.test(message), false, 'no database vocabulary');
  }
  assert.match(startAuditMessage({ id: START_BLOCKER.PENDING_WRITES, count: 1 }), /is still being saved/);
  assert.match(startAuditMessage({ id: START_BLOCKER.PENDING_WRITES, count: 3 }), /are still being saved/);
});

// ── the caption that used to be erased ──────────────────────────────────────

test('a durable caption survives an unrelated grade, note or property save', () => {
  // The device cache, as the captions effect leaves it.
  const captions = [{ photoId: 'server-photo-1', note: 'Stained grout by the bath' }];
  let stored = { pendingCaptions: captions, prop: { name: 'Old' }, audit: {}, ids: { auditId: AUDIT_A } };

  // persist() used to replace the whole blob with these keys and no captions.
  const persistWrites = {
    prop: { name: 'Hotel Borealis' }, audit: { 'RM-02': { morning: { status: 'missed' } } },
    ids: { auditId: AUDIT_A }, snapshot: null, trailQueue: [], auditTier: 'full',
    pendingQueue: { v: 1, auditId: AUDIT_A, entries: [] },
  };
  const naive = { ...persistWrites };
  assert.equal(naive.pendingCaptions, undefined, 'the defect, reproduced');

  stored = mergeDeviceState(stored, persistWrites);
  assert.deepEqual(stored.pendingCaptions, captions, 'the caption survives the grade');
  assert.equal(stored.prop.name, 'Hotel Borealis', 'and the grade still lands');

  // Reload: the caption is still there to lay back over the server's photos.
  const reloaded = JSON.parse(JSON.stringify(stored));
  assert.deepEqual(reloaded.pendingCaptions, captions);
});

test('persist merges rather than replaces, and the queue writer still merges too', () => {
  assert.match(APP, /mergeDeviceState\(previous, \{/);
  assert.match(APP, /const previous = raw \? JSON\.parse\(raw\) : \{\};/);
  assert.equal(/localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(\{\s*\n\s*prop: p/.test(APP), false,
    'the whole-blob write that erased captions is gone');
});

test('mergeDeviceState keeps unknown keys and survives rubbish', () => {
  assert.deepEqual(mergeDeviceState({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
  assert.deepEqual(mergeDeviceState(null, { a: 1 }), { a: 1 });
  assert.deepEqual(mergeDeviceState('nonsense', { a: 1 }), { a: 1 });
  assert.deepEqual(mergeDeviceState({ a: 1 }, null), { a: 1 });
});

test('a caption is only durable once its photo has a server id', () => {
  assert.deepEqual(dirtyCaptions({ k: [photo({ note: 'x', noteDirty: true })] }), [],
    'an unsent photo carries its caption in the insert instead');
  assert.deepEqual(
    dirtyCaptions({ k: [photo({ note: 'x', noteDirty: true, status: PHOTO_STATUS.SAVED, remote: { id: 'server-1' } })] }),
    [{ photoId: 'server-1', note: 'x' }],
  );
});

// ── unknown item ids ────────────────────────────────────────────────────────

test('an unknown item id is refused and reported, never silently dropped', () => {
  const q = createQueue();
  // What pushItem now does: queue it, then refuse it.
  queueWrite(q, 'GHOST-99', 'morning', { status: 'met' }, AUDIT_A);
  markFailure(q, 'GHOST-99', 'morning', unknownItemError('GHOST-99'));

  assert.equal(pendingCount(q), 1, 'the grade exists somewhere');
  assert.equal(blockedCount(q), 1, 'and it is visibly refused');
  assert.equal(blockedEntries(q)[0].error.code, UNKNOWN_ITEM_CODE);
  assert.equal(resolveSyncState({ hasSession: true, pending: 1, blocked: 1 }), SYNC.BLOCKED,
    'so the header can never read SYNCED over it');
});

test('an unknown item id does not hold up the writes around it', () => {
  const q = createQueue();
  queueWrite(q, 'GHOST-99', 'morning', { status: 'met' }, AUDIT_A);
  markFailure(q, 'GHOST-99', 'morning', unknownItemError('GHOST-99'));
  queueWrite(q, 'RM-02', 'morning', { status: 'missed' }, AUDIT_A);
  queueWrite(q, 'BTH-01', 'morning', { status: 'met' }, AUDIT_A);

  assert.deepEqual(sendableEntries(q).map((e) => e.itemId), ['RM-02', 'BTH-01'],
    'the poisoned entry is stepped over, exactly as a 42501 is');
  clearWrite(q, 'RM-02', 'morning');
  clearWrite(q, 'BTH-01', 'morning');
  assert.equal(pendingCount(q), 1, 'and the refusal is still there to be dealt with');
});

test('the refusal message names the problem in the auditor\'s words', () => {
  const q = createQueue();
  queueWrite(q, 'GHOST-99', 'morning', { status: 'met' }, AUDIT_A);
  markFailure(q, 'GHOST-99', 'morning', unknownItemError('GHOST-99'));
  const message = blockedMessage(blockedReasons(q));
  assert.match(message, /checklist items this version of the console does not have/);
  assert.match(message, /Update the console/);
  assert.equal(/GHOST-99|UNKNOWN_ITEM/.test(message), false, 'no internal id, no code');
});

test('no refusal message can print raw database text any more', () => {
  const raw = blockedMessage([{ code: 'XX999', message: 'duplicate key value violates unique constraint "audit_items_pkey"', items: ['RM-02'] }]);
  assert.equal(/duplicate key|constraint|pkey|XX999/.test(raw), false, 'the raw fallback is gone');
  assert.match(raw, /Contact Specula/);
});

test('pushItem records the refusal rather than returning early', () => {
  const push = APP.slice(APP.indexOf('const pushItem'), APP.indexOf('// Four things restart'));
  assert.equal(/if \(!ITEM_INDEX\[itemId\]\) return;/.test(push), false, 'the silent drop is gone');
  assert.match(push, /markFailure\(pendingRef\.current, itemId, shiftId, unknownItemError\(itemId\)\)/);
  assert.match(push, /persistQueue\(auditId\);/, 'and it is durable, like any other refusal');
});

// ── RETRYING ────────────────────────────────────────────────────────────────

test('a transient failure with work outstanding reads RETRYING, with the count', () => {
  assert.deepEqual(syncLabel(SYNC.ERROR, 3, 0), { text: 'RETRYING 3', tone: 'bad' });
  assert.deepEqual(syncLabel(SYNC.ERROR, 1, 0), { text: 'RETRYING 1', tone: 'bad' });
});

test('RETRYING is never shown when there is nothing to retry', () => {
  assert.equal(syncLabel(SYNC.ERROR, 0, 0).text, 'SYNC ERROR');
  for (const state of [SYNC.SYNCED, SYNC.PENDING, SYNC.SIGNED_OUT, SYNC.BLOCKED]) {
    assert.equal(/RETRYING/.test(syncLabel(state, 3, 3).text), false, `${state} must not say RETRYING`);
  }
  assert.equal(syncLabel(SYNC.SYNCED, 0, 0).text, 'SYNCED');
});

test('the state machine itself is unchanged: one resolveSyncState, same order', () => {
  assert.equal(resolveSyncState({ hasSession: false, pending: 2 }), SYNC.SIGNED_OUT);
  assert.equal(resolveSyncState({ hasSession: true, pending: 2, blocked: 1, lastError: true }), SYNC.BLOCKED);
  assert.equal(resolveSyncState({ hasSession: true, pending: 2, lastError: true }), SYNC.ERROR);
  assert.equal(resolveSyncState({ hasSession: true, pending: 2 }), SYNC.PENDING);
  assert.equal(resolveSyncState({ hasSession: true }), SYNC.SYNCED);
  assert.equal((APP.match(/resolveSyncState\(/g) || []).length, 1, 'derived in exactly one place');
});

// ── the publish gate still sees all of it ───────────────────────────────────

test('a refused foreign or unknown entry blocks publishing like any other refusal', () => {
  const q = createQueue();
  queueWrite(q, 'RM-02', 'morning', { status: 'missed' }, AUDIT_A);
  markForeignEntries(q, AUDIT_B);
  const gate = publishBlockers({
    hasSession: true, hasAudit: true,
    pendingWrites: pendingCount(q), blockedWrites: blockedCount(q),
  });
  assert.equal(gate.some((b) => b.id === BLOCKER.REFUSED_WRITES), true);
});
