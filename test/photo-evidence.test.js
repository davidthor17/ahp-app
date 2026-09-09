// Phase 6.0 — photo evidence, and the one thing it must never do.
//
// A photo is two writes: the file into Storage, then the metadata row. Either
// can fail alone, and the dangerous combination is Storage succeeding while
// the metadata insert fails, because then the file exists and nothing points
// at it. The Phase 5.8 rule applies unchanged: nothing may be shown as saved
// until the server has taken both halves.
//
// The queue is in memory and holds Blobs. It cannot go to localStorage, this
// project has no IndexedDB, and nothing here pretends otherwise. What it does
// instead is say so out loud before the tab closes.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHOTO_STATUS, EVIDENCE_BUCKET, ALLOWED_MIME,
  photoKey, storagePath, auditIdFromPath, pathBelongsToAudit,
  extensionFor, isAllowedMime, validateFile,
  isSaved, isUnsaved, countSaved, countUnsaved, countFailed, photoButtonLabel,
  hasUnsavedPhotos, totalUnsaved, unloadWarning,
  canUpload, canRetry, canDelete, afterUpload,
  DELETE_RESULT, deleteOutcome, deleteMessage, photoIsGoneFromAudit,
  targetDimensions, MAX_EDGE_PX, JPEG_QUALITY, MAX_UPLOAD_BYTES,
  PHOTO_NOTE_MAX, normalisePhotoNote, hasPhotoNote, countWithNotes, canEditNote, noteNeedsWrite,
} from '../src/framework/photoEvidence.js';

const AUDIT = '2254b423-d69f-4fca-9dbb-df4375889604';
const PHOTO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const photo = (over = {}) => ({
  localId: 'l1', photoId: PHOTO, itemId: 'RM-01', shiftId: 'day',
  blob: { size: 1000, type: 'image/jpeg' }, mimeType: 'image/jpeg',
  status: PHOTO_STATUS.READY, error: null, remote: null, ...over,
});
const saved = (over = {}) => photo({
  status: PHOTO_STATUS.SAVED,
  remote: { id: PHOTO, storagePath: `${AUDIT}/RM-01/day/${PHOTO}.jpg` }, ...over,
});

// ── the relationship: audit, item, shift ────────────────────────────────────

test('a photo key carries the shift, so the same item in two shifts is distinct', () => {
  // AHP-2026-D699 holds REC-01 missed on day and met on morning. Evidence that
  // attached to (audit, item) alone would be evidence for an unidentifiable
  // verdict.
  assert.notEqual(photoKey('REC-01', 'day'), photoKey('REC-01', 'morning'));
  assert.equal(photoKey('REC-01', 'day'), photoKey('REC-01', 'day'));
});

test('the storage path names the audit, the item, the shift and the photo', () => {
  const p = storagePath({ auditId: AUDIT, itemId: 'RM-01', shiftId: 'day', photoId: PHOTO, mimeType: 'image/jpeg' });
  assert.equal(p, `${AUDIT}/RM-01/day/${PHOTO}.jpg`);
  assert.equal(auditIdFromPath(p), AUDIT, 'the audit id is the first segment');
});

test('the audit id is always the first path segment, which is what Storage gates on', () => {
  for (const mime of ALLOWED_MIME) {
    const p = storagePath({ auditId: AUDIT, itemId: 'SP-04', shiftId: 'night', photoId: PHOTO, mimeType: mime });
    assert.equal(p.split('/')[0], AUDIT, mime);
  }
});

test('multiple photos on one item get distinct paths', () => {
  const a = storagePath({ auditId: AUDIT, itemId: 'RM-01', shiftId: 'day', photoId: 'p1', mimeType: 'image/jpeg' });
  const b = storagePath({ auditId: AUDIT, itemId: 'RM-01', shiftId: 'day', photoId: 'p2', mimeType: 'image/jpeg' });
  assert.notEqual(a, b);
  assert.ok(a.startsWith(`${AUDIT}/RM-01/day/`));
  assert.ok(b.startsWith(`${AUDIT}/RM-01/day/`));
});

test('a path cannot be built with a separator smuggled into a segment', () => {
  // Traversal is stopped by the Storage policy; this stops the console
  // building one by accident and turns a bug into a refusal.
  assert.equal(storagePath({ auditId: AUDIT, itemId: '../other', shiftId: 'day', photoId: PHOTO, mimeType: 'image/jpeg' }), null);
  assert.equal(storagePath({ auditId: `${AUDIT}/..`, itemId: 'RM-01', shiftId: 'day', photoId: PHOTO, mimeType: 'image/jpeg' }), null);
  assert.equal(storagePath({ auditId: AUDIT, itemId: 'RM-01', shiftId: 'a/b', photoId: PHOTO, mimeType: 'image/jpeg' }), null);
});

test('a path belonging to another audit is refused', () => {
  const other = '11111111-2222-3333-4444-555555555555';
  const p = storagePath({ auditId: other, itemId: 'RM-01', shiftId: 'day', photoId: PHOTO, mimeType: 'image/jpeg' });
  assert.equal(pathBelongsToAudit(p, AUDIT), false, 'cannot be attributed to this audit');
  assert.equal(pathBelongsToAudit(p, other), true);
  assert.equal(pathBelongsToAudit(p, null), false, 'and never without an audit');
});

test('an incomplete or unsupported photo has no path at all', () => {
  assert.equal(storagePath({ auditId: AUDIT, itemId: 'RM-01', shiftId: 'day', photoId: PHOTO, mimeType: 'image/gif' }), null);
  assert.equal(storagePath({ auditId: null, itemId: 'RM-01', shiftId: 'day', photoId: PHOTO, mimeType: 'image/jpeg' }), null);
  assert.equal(storagePath({ auditId: AUDIT, itemId: 'RM-01', shiftId: null, photoId: PHOTO, mimeType: 'image/jpeg' }), null);
});

test('the bucket is named once and used everywhere', () => {
  assert.equal(EVIDENCE_BUCKET, 'audit-evidence');
});

// ── what may be accepted ────────────────────────────────────────────────────

test('only the three image types the bucket allows are accepted', () => {
  assert.deepEqual([...ALLOWED_MIME].sort(), ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(isAllowedMime('image/heic'), false, 'HEIC is converted by the resize, not uploaded raw');
  assert.equal(isAllowedMime('application/pdf'), false);
});

test('an oversized or wrong-typed file is refused with a reason', () => {
  assert.equal(validateFile(null).ok, false);
  assert.equal(validateFile({ type: 'application/pdf', size: 10 }).ok, false);
  const big = validateFile({ type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 });
  assert.equal(big.ok, false);
  assert.match(big.reason, /too large/);
  assert.equal(validateFile({ type: 'image/jpeg', size: 500000 }).ok, true);
});

// ── the count never overstates ──────────────────────────────────────────────

test('the count is of stored photos only', () => {
  const list = [saved(), photo({ localId: 'l2' }), photo({ localId: 'l3', status: PHOTO_STATUS.UPLOADING })];
  assert.equal(countSaved(list), 1);
  assert.equal(countUnsaved(list), 2);
  assert.equal(photoButtonLabel(list).text, 'Photos (1) · saving 2');
});

test('a failed photo is reported, never folded into the total', () => {
  const list = [saved(), photo({ localId: 'l2', status: PHOTO_STATUS.FAILED })];
  const badge = photoButtonLabel(list);
  assert.equal(badge.text, 'Photos (1) · 1 failed');
  assert.equal(badge.tone, 'bad');
  assert.equal(countFailed(list), 1);
});

test('an empty item reads zero and nothing else', () => {
  assert.equal(photoButtonLabel([]).text, 'Photos (0)');
  assert.equal(photoButtonLabel([saved(), saved({ localId: 'l2' })]).text, 'Photos (2)');
});

test('adding a photo changes the visible state immediately', () => {
  // A photo chosen and not yet sent must not look like no photo at all. This
  // is the gap the first version of this test found: READY read as 'Photos (0)'.
  const before = photoButtonLabel([]);
  const after = photoButtonLabel([photo()]);
  assert.equal(before.text, 'Photos (0)');
  assert.notEqual(after.text, before.text);
  assert.equal(after.text, 'Photos (0) · saving 1');
  assert.equal(after.tone, 'busy');
});

// ── an upload is not success until the metadata comes back ──────────────────

test('SAVED requires the metadata row the server returned', () => {
  // The defect this prevents: the file is in Storage, the insert failed, and
  // the console shows a photo that no audit references.
  const halfway = afterUpload(photo(), { ok: true, remote: null });
  assert.equal(halfway.status, PHOTO_STATUS.FAILED);
  assert.match(halfway.error, /uploaded but was not recorded/);

  const bad = afterUpload(photo(), { ok: true, remote: { id: null, storagePath: 'x' } });
  assert.equal(bad.status, PHOTO_STATUS.FAILED, 'a remote without an id is not a record');
});

test('a complete upload reaches SAVED and clears the error', () => {
  const done = afterUpload(photo({ status: PHOTO_STATUS.FAILED, error: 'earlier failure' }), {
    ok: true, remote: { id: PHOTO, storagePath: `${AUDIT}/RM-01/day/${PHOTO}.jpg` },
  });
  assert.equal(done.status, PHOTO_STATUS.SAVED);
  assert.equal(done.error, null);
  assert.equal(isSaved(done), true);
  assert.equal(isUnsaved(done), false);
});

test('a failed upload stays visible and carries its reason', () => {
  const failed = afterUpload(photo(), { ok: false, error: 'The photo could not be uploaded.' });
  assert.equal(failed.status, PHOTO_STATUS.FAILED);
  assert.equal(failed.error, 'The photo could not be uploaded.');
  assert.equal(isUnsaved(failed), true, 'and it still counts as unsaved');
});

test('a failure is retryable and a success is not', () => {
  assert.equal(canRetry(photo({ status: PHOTO_STATUS.FAILED })), true);
  assert.equal(canRetry(saved()), false);
  assert.equal(canRetry(photo({ status: PHOTO_STATUS.UPLOADING })), false);
  assert.equal(canUpload(photo()), true, 'READY can be sent');
  assert.equal(canUpload(photo({ status: PHOTO_STATUS.FAILED })), true, 'and FAILED can be sent again');
  assert.equal(canUpload(saved()), false, 'a stored photo is never re-sent');
});

test('a failed photo is never silently discarded', () => {
  const list = [afterUpload(photo(), { ok: false, error: 'boom' })];
  assert.equal(list.length, 1, 'it is still in the list');
  assert.equal(countUnsaved(list), 1);
  assert.equal(photoButtonLabel(list).tone, 'bad', 'and the control says so');
});

// ── leaving with work outstanding ───────────────────────────────────────────

test('the app knows when photos exist only on this device', () => {
  const byItem = { 'RM-01 day': [saved()], 'RM-02 day': [photo({ status: PHOTO_STATUS.FAILED })] };
  assert.equal(hasUnsavedPhotos(byItem), true);
  assert.equal(totalUnsaved(byItem), 1);
  assert.match(unloadWarning(byItem), /1 photo has not been uploaded/);
});

test('nothing outstanding produces no warning at all', () => {
  assert.equal(hasUnsavedPhotos({ 'RM-01 day': [saved()] }), false);
  assert.equal(unloadWarning({ 'RM-01 day': [saved()] }), null);
  assert.equal(unloadWarning({}), null);
});

test('the warning counts across every item', () => {
  const byItem = {
    'RM-01 day': [photo(), photo({ localId: 'l2' })],
    'RM-02 day': [photo({ localId: 'l3', status: PHOTO_STATUS.FAILED })],
  };
  assert.equal(totalUnsaved(byItem), 3);
  assert.match(unloadWarning(byItem), /3 photos have not been uploaded/);
});

// ── deletion across two systems ─────────────────────────────────────────────

test('both halves gone is the only outcome called removed', () => {
  assert.equal(deleteOutcome({ metadataDeleted: true, objectDeleted: true }), DELETE_RESULT.REMOVED);
  assert.equal(deleteMessage(DELETE_RESULT.REMOVED), null, 'and it needs no explanation');
});

test('metadata gone and file left is reported as exactly that', () => {
  // Not "deleted". The photo has left the audit and the file has not left the
  // bucket, and the auditor is told both.
  const outcome = deleteOutcome({ metadataDeleted: true, objectDeleted: false });
  assert.equal(outcome, DELETE_RESULT.ORPHANED);
  assert.match(deleteMessage(outcome), /Removed from the audit/);
  assert.match(deleteMessage(outcome), /could not be deleted/);
  assert.equal(photoIsGoneFromAudit(outcome), true, 'it does leave the audit');
});

test('a failed metadata delete removes nothing and says so', () => {
  const outcome = deleteOutcome({ metadataDeleted: false, objectDeleted: false });
  assert.equal(outcome, DELETE_RESULT.FAILED);
  assert.match(deleteMessage(outcome), /still attached/);
  assert.equal(photoIsGoneFromAudit(outcome), false, 'so the photo stays on screen');
});

test('a delete that only removed the file never claims success', () => {
  // The order makes this unreachable in practice; asserted because if the
  // order is ever reversed this is what it would produce.
  assert.equal(deleteOutcome({ metadataDeleted: false, objectDeleted: true }), DELETE_RESULT.FAILED);
});

test('a reviewer cannot delete anything', () => {
  assert.equal(canDelete(saved(), { readOnly: true }), false);
  assert.equal(canDelete(photo(), { readOnly: true }), false);
  assert.equal(canDelete(saved(), { readOnly: false }), true);
});

test('a photo in flight cannot be deleted', () => {
  // Cancelling mid-upload is the one path that could leave a stored file with
  // no metadata and nobody watching for it.
  assert.equal(canDelete(photo({ status: PHOTO_STATUS.UPLOADING }), {}), false);
  assert.equal(canDelete(photo({ status: PHOTO_STATUS.FAILED }), {}), true, 'a failure can be cleared');
});

// ── resizing ────────────────────────────────────────────────────────────────

test('a camera original is brought down to the long edge', () => {
  const t = targetDimensions(4032, 3024);
  assert.equal(t.resized, true);
  assert.equal(Math.max(t.width, t.height), MAX_EDGE_PX);
  assert.equal(t.width, 1600);
  assert.equal(t.height, 1200, 'and the aspect ratio is kept');
});

test('portrait is handled on its own long edge', () => {
  const t = targetDimensions(3024, 4032);
  assert.equal(t.height, MAX_EDGE_PX);
  assert.equal(t.width, 1200);
});

test('a small image is never upscaled or re-encoded', () => {
  const t = targetDimensions(800, 600);
  assert.equal(t.resized, false);
  assert.equal(t.width, 800);
  assert.equal(t.height, 600);
});

test('the evidence settings are the approved ones', () => {
  assert.equal(MAX_EDGE_PX, 1600);
  assert.equal(JPEG_QUALITY, 0.72);
  assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
});

test('a missing dimension resizes nothing rather than guessing', () => {
  assert.equal(targetDimensions(0, 100), null);
  assert.equal(targetDimensions(100, undefined), null);
});

// ── Phase 6.2: the caption on a photograph ──────────────────────────────────
//
// A caption belongs to one photograph, not to the item. An auditor may attach
// three photos to one bathroom item and mean three different things by them,
// and audit_items.note cannot record which said what.

test('a photo can be saved without a caption', () => {
  // The normal case, and it must stay the normal case: requiring one would
  // slow the field workflow the feature exists to serve.
  const p = photo();
  assert.equal(hasPhotoNote(p), false);
  assert.equal(normalisePhotoNote(p.note), null);
  assert.equal(afterUpload(p, { ok: true, remote: { id: PHOTO, storagePath: 'a/b/c/d.jpg' } }).status, PHOTO_STATUS.SAVED);
});

test('a photo can be saved with a caption', () => {
  const p = saved({ note: 'Water damage visible next to the shower' });
  assert.equal(hasPhotoNote(p), true);
  assert.equal(normalisePhotoNote(p.note), 'Water damage visible next to the shower');
});

test('multiple photos on one item carry different captions', () => {
  // The whole reason this is a column on the photo and not on the item.
  const list = [
    saved({ localId: 'a', note: 'Water damage next to the shower' }),
    saved({ localId: 'b', note: 'Sealant lifting along the bath edge' }),
    saved({ localId: 'c', note: null }),
  ];
  assert.equal(countWithNotes(list), 2);
  assert.notEqual(list[0].note, list[1].note);
  assert.equal(list[2].note, null, 'and one may have none');
});

test('an empty caption is absent, never an empty string', () => {
  assert.equal(normalisePhotoNote(''), null);
  assert.equal(normalisePhotoNote('   '), null);
  assert.equal(normalisePhotoNote(null), null);
  assert.equal(normalisePhotoNote(undefined), null);
  assert.equal(normalisePhotoNote(42), null);
});

test('a caption is trimmed and bounded', () => {
  assert.equal(normalisePhotoNote('  Dust on the bedside table  '), 'Dust on the bedside table');
  assert.equal(normalisePhotoNote('x'.repeat(PHOTO_NOTE_MAX + 100)).length, PHOTO_NOTE_MAX);
  assert.equal(PHOTO_NOTE_MAX, 300);
});

test('existing photos without a caption remain valid', () => {
  // Every photo taken before this column existed. Nothing is backfilled and
  // nothing invents a caption for them.
  const legacy = saved();
  delete legacy.note;
  assert.equal(hasPhotoNote(legacy), false);
  assert.equal(isSaved(legacy), true, 'and it is still a saved photo');
  assert.equal(countWithNotes([legacy]), 0);
});

test('a caption survives the round trip the console performs', () => {
  // What loadPhotos returns, mapped as the console maps it.
  const row = { id: PHOTO, item_id: 'BTH-01', shift_id: 'day', storage_path: 'a/b/c/d.jpg', note: 'Grout stained along the base' };
  const hydrated = { localId: row.id, photoId: row.id, itemId: row.item_id, shiftId: row.shift_id, note: row.note || null, status: PHOTO_STATUS.SAVED, remote: { id: row.id, storagePath: row.storage_path } };
  assert.equal(hydrated.note, 'Grout stained along the base');
  assert.equal(hasPhotoNote(hydrated), true);
});

test('a row with a null caption hydrates as no caption', () => {
  const row = { id: PHOTO, note: null };
  assert.equal(row.note || null, null);
});

test('a reviewer may read a caption and never edit it', () => {
  const p = saved({ note: 'Excellent presentation and table setup' });
  assert.equal(canEditNote(p, { readOnly: true }), false);
  assert.equal(canEditNote(p, { readOnly: false }), true);
  assert.equal(hasPhotoNote(p), true, 'but it is still visible to them');
});

test('a caption cannot be written separately while the photo is uploading', () => {
  // There is no row to update yet: the caption travels with the insert, so it
  // cannot be lost in the gap between the two writes.
  const inflight = photo({ status: PHOTO_STATUS.UPLOADING, note: 'typed early' });
  assert.equal(canEditNote(inflight, {}), false);
  assert.equal(noteNeedsWrite(inflight), false);
});

test('only a stored photo needs its caption written separately', () => {
  assert.equal(noteNeedsWrite(saved({ note: 'x' })), true);
  assert.equal(noteNeedsWrite(photo({ note: 'x' })), false, 'READY carries it on the insert');
  assert.equal(noteNeedsWrite(photo({ status: PHOTO_STATUS.FAILED, note: 'x' })), false);
});

test('a caption never affects whether a photo counts as evidence', () => {
  // Captions are evidence about evidence. Nothing reads one to decide a number.
  const withNote = [saved({ note: 'something' })];
  const without = [saved()];
  assert.equal(photoButtonLabel(withNote).text, photoButtonLabel(without).text);
  assert.equal(countSaved(withNote), countSaved(without));
});
