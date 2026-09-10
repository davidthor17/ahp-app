/**
 * When an audit may be published, and what publishing is allowed to claim.
 *
 * Phase 6.3. The publish gate was one line:
 *
 *   disabled={!session || publishState === 'saving' || (needsLegacyAck && !legacyAck)}
 *
 * It checked nothing about whether the work had actually reached the server.
 * buildPublishedResult is fed the console's local React state, so an auditor
 * with twenty-two pending or REFUSED writes could publish a public report
 * asserting grades the database did not hold. Lose the device afterwards and
 * the report claims evidence that never existed anywhere.
 *
 * publishAudit also had no timeout. Two awaited Supabase calls, neither
 * abortable, and publishState left at 'saving' if either hung: the button
 * disabled itself forever and the auditor was trapped in PUBLISHING with no
 * way out but a reload. That is the Phase 6.1 defect again, in the one place
 * where it is irreversible.
 *
 * Everything here is pure so the rules can be tested without a browser or a
 * database, and so the gate is one list rather than a boolean nobody can read.
 */

export const PUBLISH_STATE = Object.freeze({
  IDLE: 'idle',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
});

/**
 * How long a publish may take before it is abandoned.
 *
 * Longer than an item write: this is two round trips and a payload that can
 * carry a hundred and forty sections and findings. Still bounded, because an
 * unbounded one is what trapped the auditor.
 */
export const PUBLISH_TIMEOUT_MS = 30000;

/** Everything that can stand between an audit and being published. */
export const BLOCKER = Object.freeze({
  SIGNED_OUT: 'signed_out',
  READ_ONLY: 'read_only',
  NO_AUDIT: 'no_audit',
  PENDING_WRITES: 'pending_writes',
  REFUSED_WRITES: 'refused_writes',
  UNSAVED_PHOTOS: 'unsaved_photos',
  LEGACY_ACK: 'legacy_ack',
  ALREADY_PUBLISHING: 'already_publishing',
  ALREADY_PUBLISHED: 'already_published',
});

/**
 * Every reason this audit cannot be published, in the order they matter.
 *
 * A list rather than a boolean, because the auditor has to be told which one
 * applies and a boolean cannot say. Ordered so the first entry is the one to
 * put in front of them: identity, then unsaved work, then acknowledgements.
 *
 * Deliberately NOT a blocker: incompleteness. Finishing already required every
 * item to reach a deliberate final state, so an audit that reached this screen
 * is complete by the existing rule. Adding a second, stricter completion test
 * here would move the goalposts after the auditor had finished.
 */
export function publishBlockers({
  hasSession = false,
  readOnly = false,
  hasAudit = false,
  pendingWrites = 0,
  blockedWrites = 0,
  unsavedPhotos = 0,
  needsLegacyAck = false,
  legacyAck = false,
  publishState = PUBLISH_STATE.IDLE,
} = {}) {
  const out = [];
  if (publishState === PUBLISH_STATE.PUBLISHED) out.push({ id: BLOCKER.ALREADY_PUBLISHED, count: 0 });
  if (publishState === PUBLISH_STATE.PUBLISHING) out.push({ id: BLOCKER.ALREADY_PUBLISHING, count: 0 });
  if (!hasSession) out.push({ id: BLOCKER.SIGNED_OUT, count: 0 });
  if (readOnly) out.push({ id: BLOCKER.READ_ONLY, count: 0 });
  if (!hasAudit) out.push({ id: BLOCKER.NO_AUDIT, count: 0 });
  // The one this phase exists for. Local grades that never reached the server
  // must never be baked into a public report.
  if (blockedWrites > 0) out.push({ id: BLOCKER.REFUSED_WRITES, count: blockedWrites });
  if (pendingWrites > 0) out.push({ id: BLOCKER.PENDING_WRITES, count: pendingWrites });
  if (unsavedPhotos > 0) out.push({ id: BLOCKER.UNSAVED_PHOTOS, count: unsavedPhotos });
  if (needsLegacyAck && !legacyAck) out.push({ id: BLOCKER.LEGACY_ACK, count: 0 });
  return out;
}

export const canPublish = (args) => publishBlockers(args).length === 0;

/**
 * What to show the auditor about the first blocker.
 *
 * No Postgres codes and no Supabase vocabulary. REFUSED is the one case that
 * must not promise a retry will help, because the queue has already
 * established that it will not: those writes were refused on grounds that do
 * not change by trying again.
 */
export function blockerMessage(blocker) {
  if (!blocker) return null;
  switch (blocker.id) {
    case BLOCKER.SIGNED_OUT:
      return 'You are signed out. Sign in to publish this audit.';
    case BLOCKER.READ_ONLY:
      return 'You have read only access to this audit.';
    case BLOCKER.NO_AUDIT:
      return 'This audit has not been created in Specula yet.';
    case BLOCKER.PENDING_WRITES:
      return `${blocker.count} change${blocker.count === 1 ? '' : 's'} ${blocker.count === 1 ? 'is' : 'are'} still being saved before this audit can be published.`;
    case BLOCKER.REFUSED_WRITES:
      return `${blocker.count} change${blocker.count === 1 ? '' : 's'} ${blocker.count === 1 ? 'was' : 'were'} refused by Specula and ${blocker.count === 1 ? 'is' : 'are'} not stored. Publishing now would leave ${blocker.count === 1 ? 'it' : 'them'} out of the report. Retrying will not help on its own.`;
    case BLOCKER.UNSAVED_PHOTOS:
      return `${blocker.count} photo${blocker.count === 1 ? '' : 's'} ${blocker.count === 1 ? 'has' : 'have'} not finished uploading.`;
    case BLOCKER.LEGACY_ACK:
      return 'Confirm you are publishing this as a legacy audit.';
    case BLOCKER.ALREADY_PUBLISHING:
      return 'This audit is being published.';
    case BLOCKER.ALREADY_PUBLISHED:
      return 'This audit has already been published.';
    default:
      return null;
  }
}

/** Is this blocker one the auditor can clear by waiting? */
export const isTransientBlocker = (blocker) =>
  Boolean(blocker) && (blocker.id === BLOCKER.PENDING_WRITES || blocker.id === BLOCKER.UNSAVED_PHOTOS);

// ── single flight ───────────────────────────────────────────────────────────

/**
 * May a publish start right now?
 *
 * The button being disabled is not enough on its own. React applies `disabled`
 * on the next render, and two taps inside one frame both fire, so the guard
 * has to be a value the second tap can see immediately.
 */
export const canStartPublish = (publishState) =>
  publishState === PUBLISH_STATE.IDLE || publishState === PUBLISH_STATE.FAILED;

/**
 * Where a publish attempt leaves the state machine.
 *
 * PUBLISHED is reachable only from an outcome that actually succeeded. A
 * timeout is a failure, never a success, and never leaves the machine stuck in
 * PUBLISHING: the whole reason this function exists is that the previous code
 * had no transition out of 'saving' at all when a request never settled.
 */
export function afterPublish({ ok = false, timedOut = false, reason = null } = {}) {
  if (ok) return { state: PUBLISH_STATE.PUBLISHED, reason: null, retryable: false };
  if (timedOut) {
    return {
      state: PUBLISH_STATE.FAILED,
      reason: 'timeout',
      retryable: true,
    };
  }
  return { state: PUBLISH_STATE.FAILED, reason: reason || 'error', retryable: reason !== 'schema-missing' };
}

/** What a failed publish tells the auditor. Never raw database vocabulary. */
export function publishFailureMessage(reason) {
  switch (reason) {
    case 'timeout':
      return 'Publishing took too long and was stopped. Nothing was published. Your audit is safe on this device, and you can try again.';
    case 'schema-missing':
      return 'This audit was not published. Specula cannot store a published report yet. Nothing was written, and trying again will not help until that is fixed.';
    case 'invalid-payload':
      return 'This audit was not published. The report could not be assembled from what has been recorded. Nothing was written.';
    case 'no-audit':
      return 'This audit was not published because it does not exist in Specula yet.';
    default:
      return 'This audit was not published. Check your connection and try again.';
  }
}

/** The label on the button, derived rather than assigned. */
export function publishButtonLabel(publishState) {
  switch (publishState) {
    case PUBLISH_STATE.PUBLISHING: return 'PUBLISHING…';
    case PUBLISH_STATE.PUBLISHED:  return 'PUBLISHED ✓';
    default:                       return 'PUBLISH AUDIT';
  }
}

/**
 * Is it honest to tell the auditor this audit is published?
 *
 * Only in one state, and never as a side effect of an attempt having been
 * made. This is the publish-path form of the rule the sync queue already
 * follows: nothing may claim success that the server did not confirm.
 */
export const isPublishedClaimHonest = (publishState, serverConfirmed) =>
  publishState === PUBLISH_STATE.PUBLISHED && serverConfirmed === true;
