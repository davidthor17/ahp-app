/**
 * What belongs to one audit, and what must be left behind when another is
 * opened.
 *
 * Phase 7.3. The console holds an audit's working state in a dozen pieces of
 * React state. Three load paths replace some of them and none replaces all, so
 * the leftovers followed the auditor into the next audit. Four of those are
 * published:
 *
 *   summaryDraft   typed for one hotel, frozen into another's public report
 *   auditTier      a draft row carries no tier, so the previous audit's tier
 *                  survived, and the tier decides whether the Mark is issued
 *   legacyAck      an acknowledgement given for one audit satisfied another's
 *                  publish gate
 *   photos         evidence keyed only by item and shift, uploaded against
 *                  whichever audit id was current when it finally sent
 *
 * The fix is not another guard at each call site. It is one list of what is
 * audit-scoped, applied by every path that changes which audit is open, so a
 * new piece of state is either in this list or is deliberately not audit
 * scoped. Everything here is pure, so the isolation can be tested without a
 * browser.
 */

/** The three tiers an audit may be published as. */
export const AUDIT_TIERS = Object.freeze(['desk', 'spot', 'full']);

export const DEFAULT_TIER = 'full';

/**
 * The tier to run with, given what the row says.
 *
 * A draft row has no tier yet: that is not a reason to keep the last audit's.
 * Only a value this console recognises is adopted, and anything else falls back
 * to Full, which is what an audit with no recorded tier has always been scored
 * as.
 */
export function tierForAudit(rowTier, fallback = DEFAULT_TIER) {
  if (typeof rowTier === 'string' && AUDIT_TIERS.includes(rowTier)) return rowTier;
  return AUDIT_TIERS.includes(fallback) ? fallback : DEFAULT_TIER;
}

/**
 * Every piece of state that belongs to one audit, at its empty value.
 *
 * Anything not in here is either global (the session, the role, the update
 * banner) or is restored by the load path itself from the row it just read
 * (prop, audit, snapshot, ids).
 */
export function auditScopedReset({ tier = null } = {}) {
  return {
    // evidence and its captions
    photos: {},
    pendingCaptions: [],
    photoOpen: null,
    photoNotice: null,
    lightbox: null,
    // what publishing would freeze
    summaryDraft: '',
    legacyAck: false,
    auditTier: tierForAudit(tier),
    // what this session remembers about publishing, and what the row said
    publishState: 'idle',
    publishReason: null,
    publication: null,
    publicToken: null,
    clientReportMeta: { auditedOn: null, status: 'draft' },
    // transient capture-screen state
    naPrompt: null,
    openNotes: {},
    focusItemId: null,
    sectionReturn: null,
  };
}

/** The keys above, for a test that asks whether anything was missed. */
export const AUDIT_SCOPED_KEYS = Object.freeze(Object.keys(auditScopedReset()));

// ── starting another audit ──────────────────────────────────────────────────
//
// There was no way to begin a second audit at all. ensureRemoteAudit reuses
// ids.auditId whenever one exists, and nothing cleared it, so the only route a
// field auditor would find after publishing was Edit, change the property,
// BEGIN AUDIT. That keeps the published audit's id and updates the published
// audit's property row: the next hotel's grades land on the last hotel's audit.

export const START_BLOCKER = Object.freeze({
  PENDING_WRITES: 'pending_writes',
  REFUSED_WRITES: 'refused_writes',
  UNSAVED_PHOTOS: 'unsaved_photos',
});

/**
 * Why another audit may not be started yet.
 *
 * Starting one replaces what is on this device, exactly as resuming does, so it
 * is refused for the same reasons: anything outstanding belongs to the audit
 * being left behind and would be carried onto, or lost by, the new one.
 */
export function startAuditBlockers({ pendingWrites = 0, blockedWrites = 0, unsavedPhotos = 0 } = {}) {
  const out = [];
  if (blockedWrites > 0) out.push({ id: START_BLOCKER.REFUSED_WRITES, count: blockedWrites });
  if (pendingWrites > 0) out.push({ id: START_BLOCKER.PENDING_WRITES, count: pendingWrites });
  if (unsavedPhotos > 0) out.push({ id: START_BLOCKER.UNSAVED_PHOTOS, count: unsavedPhotos });
  return out;
}

export const canStartNewAudit = (args) => startAuditBlockers(args).length === 0;

/** What to tell the auditor about the first reason. Their words, not the database's. */
export function startAuditMessage(blocker) {
  if (!blocker) return null;
  const n = blocker.count;
  switch (blocker.id) {
    case START_BLOCKER.PENDING_WRITES:
      return `${n} change${n === 1 ? '' : 's'} on this audit ${n === 1 ? 'is' : 'are'} still being saved. Wait for SYNCED, then start the new audit.`;
    case START_BLOCKER.REFUSED_WRITES:
      return `${n} change${n === 1 ? '' : 's'} on this audit ${n === 1 ? 'was' : 'were'} refused and ${n === 1 ? 'is' : 'are'} not stored. Starting a new audit now would leave ${n === 1 ? 'it' : 'them'} on this device with nowhere to go.`;
    case START_BLOCKER.UNSAVED_PHOTOS:
      return `${n} photo${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} not finished uploading. They exist only on this device and would be lost.`;
    default:
      return null;
  }
}

/**
 * The ids a new audit starts from: none.
 *
 * A separate function rather than a literal at the call site, because the
 * invariant it carries is the whole point. ensureRemoteAudit creates a row only
 * when auditId is null, so this is what makes the next audit a new audit
 * instead of more grades on the published one.
 */
export const newAuditIds = () => ({ propertyId: null, auditId: null, auditRef: null });

/**
 * Is this a genuinely new audit identity, or the previous one carried over?
 *
 * Stated as a function so the published-audit invariant can be asserted
 * directly: the ids a new audit begins with must share nothing with the audit
 * that was open before it.
 */
export function isNewAuditIdentity(previousIds = {}, nextIds = {}) {
  if (!nextIds || nextIds.auditId || nextIds.propertyId || nextIds.auditRef) return false;
  // Nothing of the previous audit may survive into the next one, so a new
  // identity is precisely a set of ids that shares none of them.
  const prev = previousIds || {};
  return nextIds.auditId !== prev.auditId
    || !prev.auditId;
}

// ── the device cache ────────────────────────────────────────────────────────

/**
 * One localStorage blob, updated without destroying the parts this writer does
 * not own.
 *
 * persist() wrote a whole fresh object holding prop, audit, ids, snapshot,
 * trailQueue, auditTier and pendingQueue. pendingCaptions is written by a
 * different effect, read-modify-write, so every grade, note or property edit
 * erased the caption text that had just been made durable. The queue's own
 * writer already merges; this is the same rule for the main writer.
 */
export function mergeDeviceState(previous, next) {
  const base = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const patch = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
  return { ...base, ...patch };
}
