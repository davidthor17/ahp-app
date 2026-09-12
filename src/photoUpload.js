/**
 * The browser half of photo evidence: resize, upload, record, remove.
 *
 * Every decision lives in framework/photoEvidence.js and is tested. This file
 * only talks to the camera, the canvas and Supabase, and is deliberately thin.
 *
 * Resizing uses createImageBitmap and canvas.toBlob, both of which iOS Safari
 * has had since 15. No dependency is added: this project runs on three runtime
 * packages and an image library would be the largest thing in the bundle for a
 * job the browser already does.
 */

import {
  EVIDENCE_BUCKET, storagePath, pathBelongsToAudit, targetDimensions,
  MAX_EDGE_PX, JPEG_QUALITY, validateFile, normalisePhotoNote,
  PHOTO_UPLOAD_TIMEOUT_MS,
} from './framework/photoEvidence.js';
import { withTimeout, isTimeoutError } from './framework/syncQueue.js';

/**
 * Downscale a camera file to something an audit can actually upload.
 *
 * Returns the original untouched if anything goes wrong. A photo that is
 * larger than we wanted is a slow upload; a photo that failed to resize and
 * was therefore dropped is lost evidence, and the second is much worse.
 */
export async function resizeImage(file, { maxEdge = MAX_EDGE_PX, quality = JPEG_QUALITY } = {}) {
  const fallback = { blob: file, width: null, height: null, resized: false };
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return fallback;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    const target = targetDimensions(bitmap.width, bitmap.height, maxEdge);
    if (!target) return fallback;

    // Already small enough. Re-encoding would only lose detail.
    if (!target.resized) {
      return { blob: file, width: bitmap.width, height: bitmap.height, resized: false };
    }

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await new Promise((resolve) => {
      try { canvas.toBlob(resolve, 'image/jpeg', quality); } catch (e) { resolve(null); }
    });
    if (!blob) return fallback;

    return { blob, width: target.width, height: target.height, resized: true };
  } catch (e) {
    return fallback;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * Make sure the evaluated row exists before evidence points at it.
 *
 * audit_item_photos has a composite foreign key onto
 * audit_items (audit_id, item_id, shift_id), so the row has to be there first.
 * An auditor can photograph an item before grading it, so this cannot be
 * assumed.
 *
 * Only the key columns and the label are sent. PostgREST updates exactly the
 * columns in the payload on conflict, so an existing grade, note, critical flag
 * or N/A reason is left alone. This must never become a way to wipe a verdict.
 */
async function ensureItemRow(supabase, { auditId, itemId, shiftId, sectionId, label }) {
  const { error } = await supabase.from('audit_items').upsert({
    audit_id: auditId, item_id: itemId, shift_id: shiftId,
    section_id: sectionId, label,
  }, { onConflict: 'audit_id,item_id,shift_id' });
  if (error) throw error;
}

/**
 * Upload one photo and record it.
 *
 * The order is the whole point. The file goes up first; only once Storage has
 * accepted it is the metadata row written; only once that row comes back does
 * the caller get a `remote` to mark the photo SAVED. A failure at either step
 * returns ok:false and the photo stays failed and retryable.
 *
 * The one state this cannot fully prevent is a stored file whose metadata
 * insert failed. It is handled rather than hidden: the upload is removed again
 * on that path, and if that cleanup also fails the file is simply unreferenced,
 * which costs space and tells no lies.
 */
export async function uploadPhoto(supabase, {
  auditId, itemId, shiftId, sectionId, label, photoId, blob, mimeType, width, height, uploadedBy, note,
  timeoutMs = PHOTO_UPLOAD_TIMEOUT_MS,
}) {
  const check = validateFile(blob);
  if (!check.ok) return { ok: false, error: check.reason };

  const path = storagePath({ auditId, itemId, shiftId, photoId, mimeType });
  if (!path) return { ok: false, error: 'Could not build a storage path for that photo.' };
  // The Storage policy is what actually enforces this. Refusing here as well
  // turns a console bug into a refusal instead of a rejected request.
  if (!pathBelongsToAudit(path, auditId)) {
    return { ok: false, error: 'That photo does not belong to this audit.' };
  }

  // Phase 7.3. Every step is bounded, like every other write in the app. An
  // unbounded photo upload left the photo UPLOADING for good: undeletable,
  // unretryable, and holding the publish gate shut. A timeout is a failure
  // like any other, so the photo becomes FAILED, which the auditor can retry
  // or remove.
  try {
    await withTimeout(
      () => ensureItemRow(supabase, { auditId, itemId, shiftId, sectionId, label }),
      { timeoutMs },
    );
  } catch (e) {
    return isTimeoutError(e)
      ? { ok: false, timedOut: true, error: 'Saving the item took too long, so the photo was not attached. Try again.' }
      : { ok: false, error: 'The item could not be saved, so the photo was not attached.' };
  }

  let upErr = null;
  try {
    const res = await withTimeout(
      () => supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, { contentType: mimeType, upsert: false }),
      { timeoutMs },
    );
    upErr = res && res.error ? res.error : null;
  } catch (e) {
    if (isTimeoutError(e)) {
      // Nothing is known to have been stored, and nothing claims it was. If the
      // file did land, it is unreferenced: recoverable, and honest.
      return { ok: false, timedOut: true, error: 'The photo took too long to upload. It is still on this device. Try again.' };
    }
    upErr = e;
  }
  if (upErr) {
    return { ok: false, error: 'The photo could not be uploaded.' };
  }

  let data = null;
  let metaErr = null;
  try {
    const res = await withTimeout(
      () => supabase
        .from('audit_item_photos')
        .insert({
          id: photoId,
          audit_id: auditId,
          item_id: itemId,
          shift_id: shiftId,
          storage_path: path,
          mime_type: mimeType,
          byte_size: blob.size ?? null,
          width: width ?? null,
          height: height ?? null,
          uploaded_by: uploadedBy || null,
          // Written with the insert rather than after it, so a caption typed
          // before the upload finished cannot be lost between the two writes.
          note: normalisePhotoNote(note),
        })
        .select('id, storage_path, created_at, note')
        .single(),
      { timeoutMs },
    );
    data = res && res.data ? res.data : null;
    metaErr = res && res.error ? res.error : null;
  } catch (e) {
    metaErr = e;
  }

  if (metaErr || !data) {
    // The file is up and nothing references it. Take it back down so the
    // bucket does not fill with orphans on a bad connection. If this also
    // fails the file is unreferenced, which is recoverable and honest; what
    // matters is that the caller is told the photo was NOT saved.
    try { await supabase.storage.from(EVIDENCE_BUCKET).remove([path]); } catch (e) { /* orphan */ }
    return isTimeoutError(metaErr)
      ? { ok: false, timedOut: true, error: 'Recording the photo took too long, so it was not attached. It is still on this device. Try again.' }
      : { ok: false, error: 'The photo uploaded but could not be recorded.' };
  }

  return {
    ok: true,
    remote: { id: data.id, storagePath: data.storage_path, createdAt: data.created_at, note: data.note || null },
  };
}

/**
 * Remove one photo.
 *
 * Metadata first, then the file. See deleteOutcome in photoEvidence.js for why
 * that order and not the other: the half-done state it can leave is an
 * unreferenced file, and the console can be honest about that. The reverse
 * leaves the console showing evidence that cannot be opened.
 */
export async function deletePhoto(supabase, { photoId, storagePath: path }) {
  const { error: metaErr } = await supabase
    .from('audit_item_photos')
    .delete()
    .eq('id', photoId);
  if (metaErr) return { metadataDeleted: false, objectDeleted: false };

  if (!path) return { metadataDeleted: true, objectDeleted: false };
  const { error: objErr } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
  return { metadataDeleted: true, objectDeleted: !objErr };
}

/** Every photo already recorded for this audit, oldest first. */
export async function loadPhotos(supabase, auditId) {
  const { data, error } = await supabase
    .from('audit_item_photos')
    .select('id, item_id, shift_id, storage_path, mime_type, width, height, created_at, note')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * A viewable URL for a stored photo.
 *
 * The bucket is private, so there is no public URL to fall back on: this is a
 * short-lived signed URL issued only to a caller the Storage policies already
 * let through.
 */
export async function signedUrl(supabase, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Change the caption on a photograph that is already stored.
 *
 * Its own call rather than part of the upload, because captions are usually
 * written after the picture is taken and often edited afterwards. Returns the
 * caption the server actually holds, so the console shows what was stored
 * rather than what was typed: the same rule the upload follows.
 */
export async function updatePhotoNote(supabase, { photoId, note }) {
  const value = normalisePhotoNote(note);
  const { data, error } = await supabase
    .from('audit_item_photos')
    .update({ note: value })
    .eq('id', photoId)
    .select('id, note')
    .maybeSingle();
  if (error || !data) return { ok: false, error: error || null };
  return { ok: true, note: data.note || null };
}
