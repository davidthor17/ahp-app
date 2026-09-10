// Phase 6.3 — publishing is irreversible, so it must never be careless.
//
// The gate was one line and checked nothing about whether the work had reached
// the server:
//
//   disabled={!session || publishState === 'saving' || (needsLegacyAck && !legacyAck)}
//
// buildPublishedResult is fed the console's local React state, so an auditor
// with twenty-two pending or REFUSED writes could publish a public report
// asserting grades the database did not hold. publishAudit also had no
// timeout: two awaited calls, neither abortable, and a hang left publishState
// at 'saving' with the button disabled forever.
//
// These tests hold both doors shut.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLISH_STATE, PUBLISH_TIMEOUT_MS, BLOCKER,
  publishBlockers, canPublish, blockerMessage, isTransientBlocker,
  canStartPublish, afterPublish, publishFailureMessage, publishButtonLabel,
  isPublishedClaimHonest,
} from '../src/framework/publishSafety.js';

const ready = (over = {}) => ({
  hasSession: true, readOnly: false, hasAudit: true,
  pendingWrites: 0, blockedWrites: 0, unsavedPhotos: 0,
  needsLegacyAck: false, legacyAck: false,
  publishState: PUBLISH_STATE.IDLE, ...over,
});

// ── the happy path ──────────────────────────────────────────────────────────

test('a signed in auditor with everything saved may publish', () => {
  assert.equal(canPublish(ready()), true);
  assert.deepEqual(publishBlockers(ready()), []);
});

// ── unsaved work blocks publishing ──────────────────────────────────────────

test('pending writes block publishing, and say how many', () => {
  // The core of this phase: never publish grades the server does not hold.
  const blockers = publishBlockers(ready({ pendingWrites: 4 }));
  assert.equal(canPublish(ready({ pendingWrites: 4 })), false);
  assert.equal(blockers[0].id, BLOCKER.PENDING_WRITES);
  assert.match(blockerMessage(blockers[0]), /4 changes are still being saved/);
});

test('one pending write reads in the singular', () => {
  const b = publishBlockers(ready({ pendingWrites: 1 }))[0];
  assert.match(blockerMessage(b), /1 change is still being saved/);
});

test('refused writes block publishing and do not promise a retry will help', () => {
  const b = publishBlockers(ready({ blockedWrites: 3 }))[0];
  assert.equal(b.id, BLOCKER.REFUSED_WRITES);
  const msg = blockerMessage(b);
  assert.match(msg, /3 changes were refused/);
  assert.match(msg, /Retrying will not help on its own/);
  assert.equal(isTransientBlocker(b), false, 'waiting will not clear it');
});

test('refused outranks pending, because it is the one that will not clear', () => {
  const blockers = publishBlockers(ready({ pendingWrites: 5, blockedWrites: 2 }));
  assert.equal(blockers[0].id, BLOCKER.REFUSED_WRITES);
});

test('unsaved photos block publishing', () => {
  const b = publishBlockers(ready({ unsavedPhotos: 2 }))[0];
  assert.equal(b.id, BLOCKER.UNSAVED_PHOTOS);
  assert.match(blockerMessage(b), /2 photos have not finished uploading/);
  assert.equal(isTransientBlocker(b), true, 'this one does clear by itself');
});

test('being signed out blocks publishing, with a reason the auditor can act on', () => {
  const b = publishBlockers(ready({ hasSession: false }))[0];
  assert.equal(b.id, BLOCKER.SIGNED_OUT);
  assert.match(blockerMessage(b), /Sign in to publish/);
});

test('a reviewer may never publish', () => {
  assert.equal(canPublish(ready({ readOnly: true })), false);
  assert.equal(publishBlockers(ready({ readOnly: true }))[0].id, BLOCKER.READ_ONLY);
});

test('an audit that does not exist in Specula cannot be published', () => {
  assert.equal(canPublish(ready({ hasAudit: false })), false);
});

test('a legacy audit needs its acknowledgement, and says so plainly', () => {
  const b = publishBlockers(ready({ needsLegacyAck: true, legacyAck: false }))[0];
  assert.equal(b.id, BLOCKER.LEGACY_ACK);
  assert.equal(canPublish(ready({ needsLegacyAck: true, legacyAck: true })), true);
});

test('every blocker produces a message, and none of them is database jargon', () => {
  for (const id of Object.values(BLOCKER)) {
    const msg = blockerMessage({ id, count: 2 });
    assert.ok(msg && msg.length > 0, id);
    assert.equal(/42501|23503|PGRST|postgres|supabase|RLS|row-level/i.test(msg), false, id);
  }
});

test('incompleteness is deliberately not a publish blocker', () => {
  // Finishing already required every item to reach a deliberate final state.
  // A second, stricter test here would move the goalposts after the fact.
  const blockers = publishBlockers(ready());
  assert.equal(blockers.some(b => /remaining|incomplete/.test(b.id)), false);
});

// ── single flight ───────────────────────────────────────────────────────────

test('only one publish may be in flight', () => {
  assert.equal(canStartPublish(PUBLISH_STATE.IDLE), true);
  assert.equal(canStartPublish(PUBLISH_STATE.PUBLISHING), false, 'a second tap is refused');
  assert.equal(canStartPublish(PUBLISH_STATE.PUBLISHED), false, 'and so is publishing twice');
});

test('a failure may be retried, a success may not', () => {
  assert.equal(canStartPublish(PUBLISH_STATE.FAILED), true);
  assert.equal(canStartPublish(PUBLISH_STATE.PUBLISHED), false);
});

test('publishing and published are themselves blockers', () => {
  assert.equal(publishBlockers(ready({ publishState: PUBLISH_STATE.PUBLISHING }))[0].id, BLOCKER.ALREADY_PUBLISHING);
  assert.equal(publishBlockers(ready({ publishState: PUBLISH_STATE.PUBLISHED }))[0].id, BLOCKER.ALREADY_PUBLISHED);
});

test('a double tap inside one frame cannot start two publishes', () => {
  // React applies `disabled` on the next render, so the guard has to be a
  // value the second tap can see immediately.
  let state = PUBLISH_STATE.IDLE;
  const attempt = () => { if (!canStartPublish(state)) return 'refused'; state = PUBLISH_STATE.PUBLISHING; return 'started'; };
  assert.equal(attempt(), 'started');
  assert.equal(attempt(), 'refused');
});

// ── timeouts and failure recovery ───────────────────────────────────────────

test('a timeout leaves FAILED, never PUBLISHING, and is retryable', () => {
  // The trap: publishState stuck at 'saving' with the button disabled forever.
  const after = afterPublish({ ok: false, timedOut: true });
  assert.equal(after.state, PUBLISH_STATE.FAILED);
  assert.notEqual(after.state, PUBLISH_STATE.PUBLISHING);
  assert.equal(after.retryable, true);
  assert.equal(canStartPublish(after.state), true, 'the auditor is not trapped');
});

test('a timeout never reads as published, and says nothing was written', () => {
  const after = afterPublish({ ok: false, timedOut: true });
  assert.notEqual(after.state, PUBLISH_STATE.PUBLISHED);
  const msg = publishFailureMessage(after.reason);
  assert.match(msg, /Nothing was published/);
  assert.match(msg, /safe on this device/);
  assert.match(msg, /try again/);
});

test('the publish timeout is bounded and longer than an item write', () => {
  assert.equal(PUBLISH_TIMEOUT_MS, 30000);
  assert.ok(PUBLISH_TIMEOUT_MS > 0 && PUBLISH_TIMEOUT_MS <= 60000);
});

test('a transient failure is retryable and says nothing was written', () => {
  const after = afterPublish({ ok: false, reason: 'error' });
  assert.equal(after.state, PUBLISH_STATE.FAILED);
  assert.equal(after.retryable, true);
  assert.match(publishFailureMessage('error'), /not published/);
});

test('a schema failure is not retryable, and says retrying will not help', () => {
  const after = afterPublish({ ok: false, reason: 'schema-missing' });
  assert.equal(after.retryable, false);
  assert.match(publishFailureMessage('schema-missing'), /trying again will not help/);
});

test('an unrenderable payload fails without writing anything', () => {
  assert.match(publishFailureMessage('invalid-payload'), /Nothing was written/);
});

test('no failure message exposes database vocabulary', () => {
  for (const reason of ['timeout', 'schema-missing', 'invalid-payload', 'no-audit', 'error']) {
    const msg = publishFailureMessage(reason);
    assert.equal(/42501|23503|PGRST|postgres|supabase|constraint/i.test(msg), false, reason);
  }
});

// ── success is only ever claimed honestly ───────────────────────────────────

test('PUBLISHED is reached only from a confirmed success', () => {
  assert.equal(afterPublish({ ok: true }).state, PUBLISH_STATE.PUBLISHED);
  assert.notEqual(afterPublish({ ok: false }).state, PUBLISH_STATE.PUBLISHED);
  assert.notEqual(afterPublish({ ok: false, timedOut: true }).state, PUBLISH_STATE.PUBLISHED);
});

test('the app may not claim published unless the server confirmed it', () => {
  assert.equal(isPublishedClaimHonest(PUBLISH_STATE.PUBLISHED, true), true);
  assert.equal(isPublishedClaimHonest(PUBLISH_STATE.PUBLISHED, false), false);
  assert.equal(isPublishedClaimHonest(PUBLISH_STATE.PUBLISHING, true), false);
  assert.equal(isPublishedClaimHonest(PUBLISH_STATE.FAILED, true), false);
});

test('the button label is derived from the state, never assigned', () => {
  assert.equal(publishButtonLabel(PUBLISH_STATE.IDLE), 'PUBLISH AUDIT');
  assert.equal(publishButtonLabel(PUBLISH_STATE.PUBLISHING), 'PUBLISHING…');
  assert.equal(publishButtonLabel(PUBLISH_STATE.PUBLISHED), 'PUBLISHED ✓');
  assert.equal(publishButtonLabel(PUBLISH_STATE.FAILED), 'PUBLISH AUDIT', 'a retry offers the same action');
});

// ── the whole journey ───────────────────────────────────────────────────────

test('the 22 unsaved grades scenario is refused, then allowed once drained', () => {
  const stuck = ready({ pendingWrites: 22 });
  assert.equal(canPublish(stuck), false);
  assert.match(blockerMessage(publishBlockers(stuck)[0]), /22 changes are still being saved/);

  const drained = ready({ pendingWrites: 0 });
  assert.equal(canPublish(drained), true);
});

test('a hung publish recovers and the second attempt succeeds', () => {
  let state = PUBLISH_STATE.IDLE;
  state = canStartPublish(state) ? PUBLISH_STATE.PUBLISHING : state;
  state = afterPublish({ ok: false, timedOut: true }).state;
  assert.equal(state, PUBLISH_STATE.FAILED);

  assert.equal(canStartPublish(state), true);
  state = PUBLISH_STATE.PUBLISHING;
  state = afterPublish({ ok: true }).state;
  assert.equal(state, PUBLISH_STATE.PUBLISHED);
  assert.equal(canStartPublish(state), false, 'and cannot be published again');
});
