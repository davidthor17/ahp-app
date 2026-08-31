// The scoring basis an audit was carried out under, frozen at the moment
// grading starts.
//
// Before this existed, an audit had no record of the conditions it was scored
// against: category and facility flags were read live from the property row.
// A hotel closing its spa, being recategorised, or an auditor editing the
// property mid-audit would silently change the result of every audit that
// property ever had, including published ones.
//
// A property record is a statement about now. An audit is a statement about a
// moment. The snapshot is what keeps them apart.
//
// Nothing here writes anywhere. Persistence is the caller's job, and the
// Supabase columns for it are prepared but not yet applied.

import { FRAMEWORK_VERSION, CHECKLIST_VERSION } from './version.js';
import { AUDIT_TYPE, DEFAULT_AUDIT_TYPE, STAR_RANK } from './weights.js';

// Flags that gate a whole section. Present since the first snapshot, so a
// snapshot is only usable if it carries all three.
export const SECTION_FACILITY_FLAGS = Object.freeze(['hasRestaurant', 'hasPool', 'hasSpa']);

// Flags that gate a single item through its `requires` field. Added later, so
// a snapshot taken before they existed simply has no opinion about them, and a
// missing value must read as present or a historical audit would lose items it
// was actually scored against.
export const DEPENDENCY_FLAGS = Object.freeze([
  'hasSauna', 'hasChangingRooms', 'hasMinibar', 'hasLunchService', 'hasGym',
]);

/** Every flag the applicability logic reads. */
export const FACILITY_FLAGS = Object.freeze([...SECTION_FACILITY_FLAGS, ...DEPENDENCY_FLAGS]);

/**
 * Build a snapshot from the property state an auditor has in front of them.
 *
 * @param {object} prop       the property as held in the console
 * @param {object} context    { auditType, scopeSections, lockedAt }
 */
export function buildSnapshot(prop = {}, context = {}) {
  const facilityProfile = {};
  // A section gate is absent unless the property says otherwise, which matches
  // isApplicable's `!profile[item.facility]` and the not-null defaults on the
  // three has_* columns.
  for (const flag of SECTION_FACILITY_FLAGS) facilityProfile[flag] = Boolean(prop[flag]);
  // A dependency gate is present unless the property explicitly says it is not.
  // This has to mirror isApplicable's `profile[item.requires] === false` exactly:
  // Boolean() would turn null, which means nobody has been asked, into false,
  // and quietly drop five fundamentals out of the audit at snapshot time.
  for (const flag of DEPENDENCY_FLAGS) facilityProfile[flag] = prop[flag] !== false;

  return {
    propertyCategory: prop.category || null,
    facilityProfile,
    auditType: context.auditType || DEFAULT_AUDIT_TYPE,
    // null means the whole catalogue. Only a Spot Audit narrows it.
    scopeSections: normaliseScope(context.scopeSections, context.auditType),
    frameworkVersion: FRAMEWORK_VERSION,
    checklistVersion: CHECKLIST_VERSION,
    lockedAt: context.lockedAt || null,
  };
}

function normaliseScope(scopeSections, auditType) {
  if (!Array.isArray(scopeSections) || scopeSections.length === 0) return null;
  if (auditType && auditType !== AUDIT_TYPE.SPOT) return null;
  return [...new Set(scopeSections)];
}

/**
 * What an audit is able to say about the basis it was scored against.
 *
 * A missing snapshot used to mean two different things — an audit that has not
 * started yet, and an audit carried out before snapshots existed — and the
 * first-grade lock could not tell them apart, so it treated an audit whose
 * basis was never recorded as one about to record its first. That minted a
 * snapshot from today's property, stamped it with today's date and the current
 * framework version, and presented a reconstruction as a record.
 *
 * These four states keep the two apart. Only NONE may ever freeze.
 */
export const SNAPSHOT_STATUS = Object.freeze({
  // No grades yet. A basis will be frozen at the first one.
  NONE: 'none',
  // A basis was recorded when grading began, and is what this audit is scored
  // against.
  FROZEN: 'frozen',
  // Grades exist and no basis was ever recorded. There is nothing to recover:
  // the conditions of the audit were not written down at the time. This never
  // becomes FROZEN, because anything it froze would be today's guess wearing a
  // historical timestamp.
  LEGACY_UNFROZEN: 'legacy-unfrozen',
  // A basis was recorded but cannot be read. Distinct from LEGACY_UNFROZEN:
  // something was written down, so it is kept exactly as found and never
  // overwritten, even though it cannot be used.
  UNUSABLE: 'unusable',
});

/** The statuses that score against the live property rather than a record. */
const UNFROZEN_STATUSES = Object.freeze([
  SNAPSHOT_STATUS.NONE, SNAPSHOT_STATUS.LEGACY_UNFROZEN, SNAPSHOT_STATUS.UNUSABLE,
]);

/**
 * Does this audit carry any recorded status at all?
 *
 * The shape is the console's: { itemId: { shiftId: { status } } }. Any status
 * counts, N/A included, which matches what the first-grade lock has always
 * treated as the start of an audit.
 */
export function hasAnyGrade(graded = {}) {
  return Object.values(graded || {}).some(
    (byShift) => Object.values(byShift || {}).some((e) => e && e.status),
  );
}

/**
 * The status of a snapshot considered on its own.
 *
 * Note what this cannot decide: with no snapshot it returns NONE, because
 * whether grades mean "not started" or "carried out before snapshots existed"
 * depends on where those grades came from, which is not visible in the state
 * itself. Only the caller that loaded them knows. Use classifyLoadedAudit for
 * that moment; this is for everything after it.
 */
export function snapshotStatusOf(snapshot) {
  if (!snapshot) return SNAPSHOT_STATUS.NONE;
  return isUsableSnapshot(snapshot) ? SNAPSHOT_STATUS.FROZEN : SNAPSHOT_STATUS.UNUSABLE;
}

/**
 * The status of an audit at the moment it is loaded from storage.
 *
 * This is the only place a legacy audit can be recognised. Grades that arrive
 * together with the audit were recorded in some earlier session; if no basis
 * arrived with them, none was ever recorded, and none may be invented now.
 */
export function classifyLoadedAudit(snapshot, graded) {
  if (snapshot) return snapshotStatusOf(snapshot);
  return hasAnyGrade(graded) ? SNAPSHOT_STATUS.LEGACY_UNFROZEN : SNAPSHOT_STATUS.NONE;
}

/** May this audit still freeze a basis at its next grade? */
export function canFreeze(status) {
  return status === SNAPSHOT_STATUS.NONE;
}

/**
 * The profile the scoring engine should use for an audit.
 *
 * Prefers the snapshot. Falls back to the live property only when no snapshot
 * exists, which is the case for audits recorded before this module, and
 * reports which of the two it used so the caller can say so.
 *
 * `status` is what the caller established when the audit was loaded. Passing
 * it is what lets the result tell a legacy audit from one that has simply not
 * started; without it the two are indistinguishable and both read as NONE.
 * It never changes the profile, only what the result admits about it.
 */
export function resolveScoringProfile(snapshot, liveProp = {}, status = null) {
  const declared = status || snapshotStatusOf(snapshot);
  if (isUsableSnapshot(snapshot)) {
    return {
      profile: { category: snapshot.propertyCategory, ...withDependencyDefaults(snapshot.facilityProfile) },
      auditType: snapshot.auditType || DEFAULT_AUDIT_TYPE,
      scopeSections: snapshot.scopeSections || null,
      source: 'snapshot',
      status: SNAPSHOT_STATUS.FROZEN,
      frozen: true,
      lockedAt: snapshot.lockedAt || null,
      frameworkVersion: snapshot.frameworkVersion || null,
      checklistVersion: snapshot.checklistVersion || null,
    };
  }

  const profile = { category: liveProp.category || null };
  for (const flag of SECTION_FACILITY_FLAGS) profile[flag] = Boolean(liveProp[flag]);
  // Present unless the property explicitly says otherwise, exactly as
  // buildSnapshot and isApplicable read it. This was `Boolean(liveProp[flag])`
  // with only undefined special-cased, which was harmless while the console
  // could not hold a null, and became a real fault the moment it could: a
  // property whose questions nobody had answered lost five items the instant it
  // was read, before any snapshot existed to protect them.
  for (const flag of DEPENDENCY_FLAGS) profile[flag] = liveProp[flag] !== false;
  return {
    profile,
    auditType: DEFAULT_AUDIT_TYPE,
    scopeSections: null,
    // Named so a reviewer can tell a reconstructed basis from a recorded one.
    source: 'live-property-fallback',
    // A frozen status can never be reported here: this branch only runs when
    // there was no readable snapshot to freeze against.
    status: declared === SNAPSHOT_STATUS.FROZEN ? SNAPSHOT_STATUS.UNUSABLE : declared,
    frozen: false,
    // Nothing is invented. An audit whose basis was never recorded has no lock
    // date and no version, and says so rather than borrowing today's.
    lockedAt: null,
    frameworkVersion: null,
    checklistVersion: null,
  };
}

/** Is this resolved basis a record of the audit, or today's stand-in for one? */
export function isUnfrozenStatus(status) {
  return UNFROZEN_STATUSES.includes(status);
}

/**
 * A frozen facility profile with any absent dependency flag read as present.
 * This is the whole of the backward compatibility story: an audit recorded
 * before a gate existed keeps every item it was scored against.
 */
export function withDependencyDefaults(facilityProfile = {}) {
  const out = { ...facilityProfile };
  for (const flag of DEPENDENCY_FLAGS) {
    if (out[flag] === undefined) out[flag] = true;
  }
  return out;
}

export function isUsableSnapshot(snapshot) {
  return Boolean(
    snapshot
    && typeof snapshot === 'object'
    && snapshot.propertyCategory
    && snapshot.facilityProfile
    // Only the section flags are required. A snapshot taken before the
    // dependency flags existed is still a valid, usable scoring basis.
    && SECTION_FACILITY_FLAGS.every((f) => typeof snapshot.facilityProfile[f] === 'boolean'),
  );
}

/**
 * Compare a snapshot with the property as it stands now.
 * Used to tell a reviewer that an audit was scored under conditions the
 * property no longer matches, which is information rather than an error.
 */
export function snapshotDrift(snapshot, liveProp = {}) {
  if (!isUsableSnapshot(snapshot)) return null;
  const changes = [];
  if (snapshot.propertyCategory !== (liveProp.category || null)) {
    changes.push({ field: 'category', was: snapshot.propertyCategory, now: liveProp.category || null });
  }
  const frozen = withDependencyDefaults(snapshot.facilityProfile);
  for (const flag of FACILITY_FLAGS) {
    const was = Boolean(frozen[flag]);
    const now = liveProp[flag] === undefined ? was : Boolean(liveProp[flag]);
    if (was !== now) changes.push({ field: flag, was, now });
  }
  return changes.length ? changes : null;
}

/**
 * Would this change to the property make the audit easier?
 *
 * Removing a facility deletes items from the audit, most of them Foundation.
 * Lowering the category removes the premium expectations. Both can only help
 * the property, which is exactly why they need a reason and a trail. Adding a
 * facility or raising the category can only add items, so it is free.
 */
export function isFavourableChange(snapshot, nextProp = {}) {
  if (!isUsableSnapshot(snapshot)) return false;
  const frozen = withDependencyDefaults(snapshot.facilityProfile);
  for (const flag of FACILITY_FLAGS) {
    if (frozen[flag] && nextProp[flag] === false) return true;
  }
  const wasRank = STAR_RANK[snapshot.propertyCategory];
  const nowRank = STAR_RANK[nextProp.category];
  if (wasRank !== undefined && nowRank !== undefined && nowRank < wasRank) return true;
  return false;
}

/** Narrowing a Spot Audit's scope removes items, so it can only help. */
export function isFavourableScopeChange(snapshot, nextScope) {
  if (!isUsableSnapshot(snapshot) || !snapshot.scopeSections) return false;
  if (!Array.isArray(nextScope)) return false;
  return snapshot.scopeSections.some((s) => !nextScope.includes(s));
}

// ── Persistence ─────────────────────────────────────────────────────────────
//
// A snapshot lived only in React state and localStorage, which made it the one
// part of an audit that could not survive a lost browser profile. The columns
// to hold it are added by migrations/2026-08-28-phase4b-scoring-integrity.sql.
//
// The audit row is authoritative. Local storage is a cache that lets an offline
// auditor keep working, and it is consulted only when the row carries nothing.
// A row that already holds a basis is never replaced from local state: one
// client writes it once, and a stale cache must not be able to overwrite it.

/** The six audits columns a frozen snapshot occupies. */
export const SNAPSHOT_COLUMNS = Object.freeze([
  'property_category', 'facility_profile', 'scope_sections',
  'framework_version', 'checklist_version', 'snapshot_locked_at',
]);

/**
 * A frozen snapshot as an audits-row patch.
 * Returns null when there is nothing worth persisting, so a caller cannot
 * accidentally write a half-formed basis.
 */
export function snapshotToRow(snapshot) {
  if (!isUsableSnapshot(snapshot)) return null;
  return {
    property_category: snapshot.propertyCategory,
    facility_profile: snapshot.facilityProfile,
    scope_sections: snapshot.scopeSections || null,
    framework_version: snapshot.frameworkVersion || null,
    checklist_version: snapshot.checklistVersion || null,
    snapshot_locked_at: snapshot.lockedAt || null,
  };
}

/**
 * Read a snapshot back out of an audits row.
 *
 * `snapshot_locked_at` is the marker: a row without it never froze, whatever
 * else the columns happen to hold. Returns null rather than a partial snapshot,
 * so a row with some columns set and no lock date reads as no basis at all
 * rather than as a basis nobody recorded.
 */
export function snapshotFromRow(row) {
  if (!row || !row.snapshot_locked_at || !row.property_category) return null;
  const snapshot = {
    propertyCategory: row.property_category,
    facilityProfile: row.facility_profile || null,
    auditType: row.tier || DEFAULT_AUDIT_TYPE,
    scopeSections: row.scope_sections || null,
    frameworkVersion: row.framework_version || null,
    checklistVersion: row.checklist_version || null,
    lockedAt: row.snapshot_locked_at,
  };
  return isUsableSnapshot(snapshot) ? snapshot : null;
}

/**
 * Which snapshot an audit should be loaded with, given both sources.
 *
 * The order the rollout settled on: the persisted row first, local storage
 * second, and nothing invented if neither has one. Returning the source as well
 * as the snapshot lets the caller record where a basis came from without
 * re-deriving it.
 */
export function pickSnapshot(rowSnapshot, localSnapshot) {
  if (isUsableSnapshot(rowSnapshot)) return { snapshot: rowSnapshot, source: 'audit-row' };
  if (isUsableSnapshot(localSnapshot)) return { snapshot: localSnapshot, source: 'local-cache' };
  // A truthy but unreadable local snapshot is kept rather than discarded: it is
  // something somebody wrote down, and classifyLoadedAudit reports it as
  // unusable rather than pretending the audit never had a basis.
  if (localSnapshot) return { snapshot: localSnapshot, source: 'local-cache' };
  return { snapshot: null, source: 'none' };
}

/** May this audit's basis be written to its row? Only a real, first lock. */
export function shouldPersistSnapshot(snapshot, rowSnapshot) {
  return isUsableSnapshot(snapshot) && !isUsableSnapshot(rowSnapshot);
}
