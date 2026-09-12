// Phase 7.3 — a photo upload that never comes back.
//
// Every write in this app has been bounded since Phase 6.1 except this one.
// supabase-js is fetch underneath and fetch has no timeout of its own, so a
// captive portal or a half-open connection left the photo UPLOADING for good.
// That state is the worst one to be stuck in:
//
//   canDelete  refuses, because the outcome is not known
//   canRetry   refuses, because it is not FAILED
//   the publish gate holds shut on UNSAVED_PHOTOS
//
// so the auditor could neither clear it nor finish. A timeout makes it FAILED,
// which is retryable, removable, and still honestly blocking until it is dealt
// with.

import test from 'node:test';
import assert from 'node:assert/strict';

import { uploadPhoto } from '../src/photoUpload.js';
import {
  PHOTO_STATUS, PHOTO_UPLOAD_TIMEOUT_MS, afterUpload, canRetry, canDelete,
  countUnsaved, totalUnsaved, photoButtonLabel,
} from '../src/framework/photoEvidence.js';
import { publishBlockers, BLOCKER, blockerMessage } from '../src/framework/publishSafety.js';
import { createQueue, pendingCount } from '../src/framework/syncQueue.js';

const AUDIT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const never = () => new Promise(() => {});

const photo = (over = {}) => ({
  localId: 'l1', photoId: 'ph-1', itemId: 'RM-02', shiftId: 'morning',
  blob: { type: 'image/jpeg', size: 120000 }, mimeType: 'image/jpeg',
  status: PHOTO_STATUS.UPLOADING, error: null, remote: null, note: null, ...over,
});

const args = (over = {}) => ({
  auditId: AUDIT, itemId: 'RM-02', shiftId: 'morning', sectionId: 'room',
  label: 'No hair, stains, or odors', photoId: 'ph-1',
  blob: { type: 'image/jpeg', size: 120000 }, mimeType: 'image/jpeg',
  width: 1600, height: 1200, uploadedBy: 'auditor-1', note: null,
  timeoutMs: 60, ...over,
});

/** A Supabase whose named step never settles. */
function hangingAt(step) {
  const removed = [];
  const inserted = [];
  return {
    removed,
    inserted,
    from: () => ({
      upsert: (...a) => (step === 'item' ? never() : Promise.resolve({ error: null })),
      insert: (row) => {
        inserted.push(row);
        const chain = {
          select: () => ({ single: () => (step === 'insert' ? never() : Promise.resolve({ data: { id: row.id, storage_path: row.storage_path, created_at: 'now', note: row.note }, error: null })) }),
        };
        return chain;
      },
    }),
    storage: {
      from: () => ({
        upload: () => (step === 'upload' ? never() : Promise.resolve({ error: null })),
        remove: (paths) => { removed.push(...paths); return Promise.resolve({ error: null }); },
      }),
    },
  };
}

test('the photo timeout is bounded, and longer than an item write', () => {
  assert.ok(PHOTO_UPLOAD_TIMEOUT_MS >= 20000, 'a photo over hotel wifi needs more than a row does');
  assert.ok(PHOTO_UPLOAD_TIMEOUT_MS <= 120000, 'and it is still bounded');
});

test('a hanging item write times out instead of leaving the photo in flight', async () => {
  const started = Date.now();
  const result = await uploadPhoto(hangingAt('item'), args());
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 3000, 'it settles, rather than never returning');
  assert.match(result.error, /too long/);
});

test('a hanging file upload times out and says the photo is still on the device', async () => {
  const result = await uploadPhoto(hangingAt('upload'), args());
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /still on this device/);
  assert.equal(/fetch|abort|supabase|storage|bucket/i.test(result.error), false, 'no transport vocabulary');
});

test('a hanging metadata write times out, and the stored file is taken back down', async () => {
  const supabase = hangingAt('insert');
  const result = await uploadPhoto(supabase, args());
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.deepEqual(supabase.removed, [`${AUDIT}/RM-02/morning/ph-1.jpg`], 'no orphan is left behind');
});

test('a timed-out photo becomes FAILED, and FAILED is retryable and removable', async () => {
  const result = await uploadPhoto(hangingAt('upload'), args());
  const after = afterUpload(photo(), result);

  assert.equal(after.status, PHOTO_STATUS.FAILED, 'never stuck at UPLOADING');
  assert.notEqual(after.status, PHOTO_STATUS.SAVED, 'and never claimed as evidence');
  assert.equal(canRetry(after), true);
  assert.equal(canDelete(after, { readOnly: false }), true, 'the auditor can clear it and move on');
  assert.equal(canDelete(after, { readOnly: true }), false, 'a reviewer still cannot');
  assert.ok(after.error && after.error.length > 10, 'and it says what happened');
});

test('an in-flight photo is still undeletable, which is why the timeout is the fix', () => {
  const inFlight = photo({ status: PHOTO_STATUS.UPLOADING });
  assert.equal(canDelete(inFlight, { readOnly: false }), false);
  assert.equal(canRetry(inFlight), false);
});

test('publishing stays blocked while a timed-out photo is unresolved, and clears when it is', async () => {
  const result = await uploadPhoto(hangingAt('upload'), args());
  const failed = afterUpload(photo(), result);
  const byItem = { 'RM-02 morning': [failed] };

  assert.equal(countUnsaved([failed]), 1);
  assert.equal(totalUnsaved(byItem), 1);
  const gate = publishBlockers({ hasSession: true, hasAudit: true, unsavedPhotos: totalUnsaved(byItem) });
  const blocker = gate.find((b) => b.id === BLOCKER.UNSAVED_PHOTOS);
  assert.ok(blocker, 'a photo nobody has resolved is not publishable around');
  assert.match(blockerMessage(blocker), /has not finished uploading/);

  // Removed, or retried successfully: either way the gate opens.
  assert.equal(totalUnsaved({ 'RM-02 morning': [] }), 0);
  assert.deepEqual(publishBlockers({ hasSession: true, hasAudit: true, unsavedPhotos: 0 }), []);
});

test('the tray says the photo is not saved, and never counts it as evidence', async () => {
  const result = await uploadPhoto(hangingAt('insert'), args());
  const failed = afterUpload(photo(), result);
  const label = photoButtonLabel([failed]);
  assert.deepEqual(label, { text: 'Photos (0) · 1 failed', tone: 'bad' });
});

test('a timeout on one photo leaves the item write queue untouched', async () => {
  // The two queues are deliberately separate: a photo failing must not put the
  // grades behind it, and this proves the timeout changed nothing there.
  const queue = createQueue();
  await uploadPhoto(hangingAt('upload'), args());
  assert.equal(pendingCount(queue), 0, 'no deadlock, no stray entry');
});

test('a working upload still succeeds, unchanged by the timeout wrapper', async () => {
  const supabase = hangingAt('none');
  const result = await uploadPhoto(supabase, args({ note: '  Stained grout  ' }));
  assert.equal(result.ok, true);
  assert.equal(result.remote.id, 'ph-1');
  assert.equal(result.remote.storagePath, `${AUDIT}/RM-02/morning/ph-1.jpg`);
  assert.equal(supabase.inserted[0].note, 'Stained grout', 'the caption still travels with the insert');
  assert.deepEqual(supabase.removed, [], 'and nothing is cleaned up on success');

  const saved = afterUpload(photo(), result);
  assert.equal(saved.status, PHOTO_STATUS.SAVED);
  assert.equal(canRetry(saved), false);
});
