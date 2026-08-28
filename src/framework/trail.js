// Audit trail for changes that could improve a result.
//
// Logging every edit would flood an offline PWA and be ignored in review. The
// rule here is narrower and sharper: record a change only when it could make
// the audit easier on the property. A grade moving from Met to Missed needs no
// trail; the same grade moving back does.
//
// This decides what to record and shapes the entry. It does not write anywhere.
// Entries are destined for public.activity_log, which already exists with the
// right shape and already permits internal users to insert.

import { STATUS, SEVERITY, SEVERITY_LADDER, STRUCTURAL_NA_REASONS } from './weights.js';

export const TRAIL_ENTITY = 'audit';

export const TRAIL_ACTION = Object.freeze({
  STATUS_IMPROVED: 'status_improved',
  STATUS_TO_NA: 'status_to_na',
  NA_REASON_CHANGED: 'na_reason_changed',
  SEVERITY_LOWERED: 'severity_lowered',
  FACILITY_REMOVED: 'facility_removed',
  CATEGORY_LOWERED: 'category_lowered',
  SCOPE_NARROWED: 'scope_narrowed',
});

// How much better a status is for the property. Used only to decide whether a
// change was in the property's favour, never to score anything.
const FAVOUR = {
  [STATUS.MISSED]: 0,
  [STATUS.PARTIAL]: 1,
  [STATUS.MET]: 2,
};

/**
 * Should this item change be recorded?
 *
 * @param {object} before  { status, naReason } as previously recorded
 * @param {object} after   { status, naReason } as now recorded
 * @returns {object|null}  a reason descriptor, or null when nothing to record
 */
export function itemChangeIsMaterial(before = {}, after = {}) {
  const wasStatus = before.status || null;
  const nowStatus = after.status || null;
  if (wasStatus === nowStatus && before.naReason === after.naReason) return null;

  // First assessment of an item is not a change, it is the observation itself.
  if (!wasStatus) return null;

  // Any failing grade turning into N/A hides it from the score.
  if (nowStatus === STATUS.NA && (wasStatus === STATUS.MISSED || wasStatus === STATUS.PARTIAL)) {
    return {
      action: TRAIL_ACTION.STATUS_TO_NA,
      requiresReason: true,
      requiresRelease: STRUCTURAL_NA_REASONS.includes(after.naReason),
    };
  }

  // An observational N/A becoming structural erases the item entirely.
  if (wasStatus === STATUS.NA && nowStatus === STATUS.NA
      && !STRUCTURAL_NA_REASONS.includes(before.naReason)
      && STRUCTURAL_NA_REASONS.includes(after.naReason)) {
    return { action: TRAIL_ACTION.NA_REASON_CHANGED, requiresReason: true, requiresRelease: true };
  }

  // A failing grade improving.
  if (FAVOUR[nowStatus] !== undefined && FAVOUR[wasStatus] !== undefined
      && FAVOUR[nowStatus] > FAVOUR[wasStatus]) {
    return { action: TRAIL_ACTION.STATUS_IMPROVED, requiresReason: false, requiresRelease: false };
  }

  // Everything else either lowers the score or is neutral, so it needs no trail.
  return null;
}

/** Should this severity change be recorded? Only downward moves can help. */
export function severityChangeIsMaterial(before, after) {
  if (!before || !after || before === after) return null;
  const wasZt = before === SEVERITY.ZERO_TOLERANCE;
  const wasRank = wasZt ? SEVERITY_LADDER.length : SEVERITY_LADDER.indexOf(before);
  const nowRank = after === SEVERITY.ZERO_TOLERANCE ? SEVERITY_LADDER.length : SEVERITY_LADDER.indexOf(after);
  if (nowRank >= wasRank) return null;
  return {
    action: TRAIL_ACTION.SEVERITY_LOWERED,
    requiresReason: true,
    requiresRelease: wasRank >= SEVERITY_LADDER.indexOf(SEVERITY.CRITICAL),
  };
}

/**
 * Shape a trail entry for activity_log.
 * `diff` carries what changed, from what, to what and why.
 */
export function trailEntry({ auditId, actorId, action, itemId = null, field = null, from = null, to = null, reason = null, at = null }) {
  return {
    entity_type: TRAIL_ENTITY,
    entity_id: auditId,
    actor_id: actorId || null,
    action,
    diff: {
      itemId,
      field,
      from,
      to,
      reason: reason || null,
      // Recorded by the device, because an offline entry can be written long
      // before it reaches the server and created_at would misdate it.
      observedAt: at || new Date().toISOString(),
    },
  };
}

/** Trail entries for a snapshot change, one per field that moved. */
export function snapshotTrailEntries({ auditId, actorId, drift, reason, at }) {
  if (!Array.isArray(drift)) return [];
  return drift.map((change) => trailEntry({
    auditId,
    actorId,
    action: change.field === 'category' ? TRAIL_ACTION.CATEGORY_LOWERED : TRAIL_ACTION.FACILITY_REMOVED,
    field: change.field,
    from: change.was,
    to: change.now,
    reason,
    at,
  }));
}
