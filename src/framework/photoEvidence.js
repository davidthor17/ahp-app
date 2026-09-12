/**
 * Photo evidence: what state a photo is in, and what may be claimed about it.
 *
 * Phase 6.0. The rule this module exists to enforce is the one from Phase 5.8,
 * applied to a second kind of write: a photo must never be presented as saved
 * until the server has taken both halves of it. A photo is two writes, not one,
 * and either can fail on its own:
 *
 *   1. the file into the audit-evidence Storage bucket
 *   2. the metadata row into public.audit_item_photos
 *
 * Storage succeeding and metadata failing is the dangerous combination,
 * because the file exists and nothing points at it. That is why SAVED is
 * reached only after the metadata insert returns, and why a photo that got
 * halfway is FAILED and retryable rather than quietly gone.
 *
 * This is not offline mode. The queue is in memory and holds Blobs, which
 * cannot go in localStorage and which this project has no IndexedDB to put
 * anywhere else. A photo selected and not uploaded survives while the page is
 * open and no longer. hasUnsavedPhotos exists so the app can say so out loud
 * before the auditor closes the tab.
 */

export const PHOTO_STATUS = Object.freeze({
  READY: 'ready',
  UPLOADING: 'uploading',
  SAVED: 'saved',
  FAILED: 'failed',
});

/** Statuses that mean the server does not have this photo. */
const UNSAVED = Object.freeze([PHOTO_STATUS.READY, PHOTO_STATUS.UPLOADING, PHOTO_STATUS.FAILED]);

/** One key per evaluated row, matching the audit_items natural key. */
export const photoKey = (itemId, shiftId) => `${itemId} ${shiftId}`;

// ── storage paths ───────────────────────────────────────────────────────────

export const EVIDENCE_BUCKET = 'audit-evidence';

const EXT_BY_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const ALLOWED_MIME = Object.freeze(Object.keys(EXT_BY_MIME));

export const extensionFor = (mimeType) => EXT_BY_MIME[mimeType] || null;

export const isAllowedMime = (mimeType) => ALLOWED_MIME.includes(mimeType);

/**
 * Where one photo lives inside the bucket.
 *
 * The audit id is first and stays first: the Storage policies gate on
 * (storage.foldername(name))[1], so the leading segment is the only thing
 * standing between an auditor and another audit's evidence. Everything after
 * it is for tracing by eye.
 */
export function storagePath({ auditId, itemId, shiftId, photoId, mimeType }) {
  const ext = extensionFor(mimeType);
  if (!auditId || !itemId || !shiftId || !photoId || !ext) return null;
  if ([auditId, itemId, shiftId, photoId].some((p) => /[/\\]/.test(String(p)))) return null;
  return `${auditId}/${itemId}/${shiftId}/${photoId}.${ext}`;
}

/** The audit id a path claims to belong to, as the Storage policy reads it. */
export const auditIdFromPath = (path) =>
  (typeof path === 'string' && path.includes('/')) ? path.split('/')[0] : null;

/**
 * Does this path belong to this audit?
 *
 * Belt and braces over the Storage policy rather than a replacement for it.
 * The policy is what actually stops a crafted path; this stops the console
 * from building one by accident and turns a bug into a refusal.
 */
export const pathBelongsToAudit = (path, auditId) =>
  Boolean(auditId) && auditIdFromPath(path) === auditId;

// ── counting, and what the control says ─────────────────────────────────────

export const isSaved = (photo) => photo && photo.status === PHOTO_STATUS.SAVED;
export const isUnsaved = (photo) => Boolean(photo) && UNSAVED.includes(photo.status);

export const countSaved = (photos = []) => photos.filter(isSaved).length;
export const countUnsaved = (photos = []) => photos.filter(isUnsaved).length;
export const countFailed = (photos = []) =>
  photos.filter((p) => p && p.status === PHOTO_STATUS.FAILED).length;

/**
 * The label on the control.
 *
 * The count is of photos actually stored. An upload in flight is not evidence
 * yet, and counting it would be the same lie as a green SYNCED over a failed
 * write. Anything outstanding is reported separately, never folded into the
 * total.
 */
export function photoButtonLabel(photos = []) {
  const saved = countSaved(photos);
  const failed = countFailed(photos);
  // READY counts here as well as UPLOADING. A photo the auditor has just
  // chosen is on the device and not on the server, and showing "Photos (0)"
  // for it would be indistinguishable from having attached nothing at all.
  const pending = photos.filter(
    (p) => p && (p.status === PHOTO_STATUS.READY || p.status === PHOTO_STATUS.UPLOADING),
  ).length;
  if (failed > 0) return { text: `Photos (${saved}) · ${failed} failed`, tone: 'bad' };
  if (pending > 0) return { text: `Photos (${saved}) · saving ${pending}`, tone: 'busy' };
  return { text: `Photos (${saved})`, tone: saved > 0 ? 'ok' : 'muted' };
}

/** Is anything on this device not yet on the server? */
export const hasUnsavedPhotos = (byItem = {}) =>
  Object.values(byItem).some((list) => countUnsaved(list) > 0);

export const totalUnsaved = (byItem = {}) =>
  Object.values(byItem).reduce((n, list) => n + countUnsaved(list), 0);

/**
 * The warning shown when the auditor tries to leave with photos outstanding.
 *
 * Returns null when there is nothing to say, so the handler can be registered
 * unconditionally and stay silent unless it has a real reason.
 */
export function unloadWarning(byItem = {}) {
  const n = totalUnsaved(byItem);
  if (n === 0) return null;
  return `${n} photo${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} not been uploaded yet and will be lost.`;
}

// ── the state machine ───────────────────────────────────────────────────────

/** May this photo be sent, or sent again? */
export const canUpload = (photo) =>
  Boolean(photo) && (photo.status === PHOTO_STATUS.READY || photo.status === PHOTO_STATUS.FAILED);

/** May the auditor retry it by hand? Only a failure offers that. */
export const canRetry = (photo) => Boolean(photo) && photo.status === PHOTO_STATUS.FAILED;

/**
 * May this photo be removed?
 *
 * A reviewer never removes anything, matching the read-only model everywhere
 * else. An upload in flight is not removable because the outcome is not known
 * yet, and cancelling it would be the one path that could leave a stored file
 * with no metadata and nobody watching.
 */
export function canDelete(photo, { readOnly = false } = {}) {
  if (readOnly || !photo) return false;
  return photo.status !== PHOTO_STATUS.UPLOADING;
}

/**
 * What a photo becomes when an upload finishes.
 *
 * `remote` is required for SAVED. Reaching SAVED without the metadata row the
 * server returned is precisely the claim this module exists to prevent, so it
 * is refused here rather than trusted to the caller.
 */
export function afterUpload(photo, { ok, remote = null, error = null }) {
  if (!photo) return photo;
  if (ok && remote && remote.id && remote.storagePath) {
    return { ...photo, status: PHOTO_STATUS.SAVED, remote, error: null };
  }
  return {
    ...photo,
    status: PHOTO_STATUS.FAILED,
    error: error || (ok ? 'The photo uploaded but was not recorded.' : 'Upload failed.'),
  };
}

// ── deletion ────────────────────────────────────────────────────────────────

export const DELETE_RESULT = Object.freeze({
  REMOVED: 'removed',
  ORPHANED: 'orphaned',
  FAILED: 'failed',
});

/**
 * Postgres and Storage cannot be deleted atomically, so the order is chosen by
 * which half-done state is safe to be left in.
 *
 * Metadata first. If the file delete then fails, the photo is genuinely gone
 * from the audit and the console is telling the truth about it; what remains is
 * an unreferenced file, which is findable and costs only space. The other order
 * risks a metadata row pointing at a file that no longer exists, which is a
 * console showing evidence that cannot be opened.
 *
 * That leaves one case that must not be described as success, and is not:
 * ORPHANED says the photo was removed from the audit and the file was not
 * deleted, in those words.
 */
export function deleteOutcome({ metadataDeleted, objectDeleted }) {
  if (!metadataDeleted) return DELETE_RESULT.FAILED;
  return objectDeleted ? DELETE_RESULT.REMOVED : DELETE_RESULT.ORPHANED;
}

export function deleteMessage(outcome) {
  switch (outcome) {
    case DELETE_RESULT.REMOVED:  return null;
    case DELETE_RESULT.ORPHANED: return 'Removed from the audit. The stored file could not be deleted and will be cleared up later.';
    default:                     return 'The photo could not be removed. It is still attached.';
  }
}

/** Did the audit actually lose the photo? True for both delete outcomes. */
export const photoIsGoneFromAudit = (outcome) => outcome !== DELETE_RESULT.FAILED;

// ── resizing ────────────────────────────────────────────────────────────────

/**
 * Evidence, not photography.
 *
 * A modern phone camera produces roughly 4000 by 3000 and 3 to 5 MB. A hotel
 * audit is a hundred and more items over a day on hotel wifi, so uploading
 * originals is how an audit stops halfway. 1600px on the long edge at JPEG 0.72
 * lands around 200 to 400 KB and still reads a stained grout line, a chipped
 * skirting board or a menu.
 *
 * Nothing is upscaled: a small image is left exactly as it is.
 */
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.72;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * How long one photo may take before the upload is abandoned.
 *
 * Phase 7.3. Every other write in this app has been bounded since Phase 6.1;
 * the photo path was the one that was not. A hung upload left the photo
 * UPLOADING forever, which cannot be deleted (the outcome is unknown) and
 * cannot be retried (it is not FAILED), while UNSAVED_PHOTOS held the publish
 * gate shut. The auditor could neither finish nor clear it.
 *
 * Longer than an item write, because this is a file over hotel wifi rather
 * than one row, and still bounded, because unbounded is what trapped them.
 */
export const PHOTO_UPLOAD_TIMEOUT_MS = 45000;

export function targetDimensions(width, height, maxEdge = MAX_EDGE_PX) {
  if (!width || !height) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, resized: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

/** Is this file something we are willing to accept at all? */
export function validateFile(file) {
  if (!file) return { ok: false, reason: 'No file was selected.' };
  if (!isAllowedMime(file.type)) {
    return { ok: false, reason: 'Only JPEG, PNG and WebP photos can be attached.' };
  }
  if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'That photo is too large to upload.' };
  }
  return { ok: true, reason: null };
}

// ── the caption ─────────────────────────────────────────────────────────────

/**
 * A caption belongs to one photograph, not to the item.
 *
 * An auditor may attach three photos to one bathroom item and mean three
 * different things by them. audit_items.note is the note about the item as a
 * whole; collapsing captions into it would lose which photograph said what.
 *
 * Always optional. A photo saved without one is the normal case.
 */
export const PHOTO_NOTE_MAX = 300;

export function normalisePhotoNote(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;               // empty is absent, never a caption
  return trimmed.slice(0, PHOTO_NOTE_MAX);
}

export const hasPhotoNote = (photo) => Boolean(photo && normalisePhotoNote(photo.note));

/** How many of these photographs carry a caption. */
export const countWithNotes = (photos = []) => photos.filter(hasPhotoNote).length;

/**
 * May this caption be edited?
 *
 * A reviewer never edits. An upload in flight is not editable because the row
 * it would be written to does not exist yet; the caption travels with the
 * insert instead.
 */
export function canEditNote(photo, { readOnly = false } = {}) {
  if (readOnly || !photo) return false;
  return photo.status !== PHOTO_STATUS.UPLOADING;
}

/** A caption is only persisted separately once the photo itself exists. */
export const noteNeedsWrite = (photo) =>
  Boolean(photo && photo.status === PHOTO_STATUS.SAVED && photo.remote && photo.remote.id);

// ── durable caption text (Phase 6.4) ────────────────────────────────────────
//
// A caption typed and not yet committed lived only in React state: readable
// on screen, gone on reload. That is a smaller version of the same defect the
// item queue has — text the auditor wrote existing nowhere but the tab.
//
// The photo itself is explicitly not this phase's problem: the file is a Blob
// and stays in-memory-only, as documented above. A caption is a few words of
// text keyed to a photo that already has a server id, which is exactly the
// kind of small structured write the durable queue already handles for
// grades. Keyed by the server photo id rather than localId, because localId
// is only ever known to the tab that created it and would not survive a
// reload in the first place.

/** Every caption on this device the server does not yet hold, as plain JSON. */
export function dirtyCaptions(byItem = {}) {
  const out = [];
  for (const list of Object.values(byItem)) {
    for (const p of list || []) {
      if (p && p.noteDirty && p.remote && p.remote.id) {
        out.push({ photoId: p.remote.id, note: p.note || null });
      }
    }
  }
  return out;
}

/**
 * Lay restored caption text back over a freshly loaded photo list.
 *
 * Runs after loadPhotos, the same place a pending item write is reapplied
 * over what the server returned: the server's answer is not wrong, it is
 * just missing what has not reached it yet.
 */
export function applyDirtyCaptions(byItem = {}, dirty = []) {
  if (!Array.isArray(dirty) || dirty.length === 0) return byItem;
  const byPhotoId = new Map(dirty.map((d) => [d.photoId, d.note]));
  const out = {};
  for (const [key, list] of Object.entries(byItem)) {
    out[key] = (list || []).map((p) => {
      if (p && p.remote && p.remote.id && byPhotoId.has(p.remote.id)) {
        return { ...p, note: byPhotoId.get(p.remote.id), noteDirty: true };
      }
      return p;
    });
  }
  return out;
}
