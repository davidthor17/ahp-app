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
  for (const flag of SECTION_FACILITY_FLAGS) facilityProfile[flag] = Boolean(prop[flag]);
  // A dependency flag the property has never been asked about defaults to
  // present, so a new gate can never remove an item from an audit by surprise.
  for (const flag of DEPENDENCY_FLAGS) facilityProfile[flag] = prop[flag] === undefined ? true : Boolean(prop[flag]);

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
 * The profile the scoring engine should use for an audit.
 *
 * Prefers the snapshot. Falls back to the live property only when no snapshot
 * exists, which is the case for audits recorded before this module, and
 * reports which of the two it used so the caller can say so.
 */
export function resolveScoringProfile(snapshot, liveProp = {}) {
  if (isUsableSnapshot(snapshot)) {
    return {
      profile: { category: snapshot.propertyCategory, ...withDependencyDefaults(snapshot.facilityProfile) },
      auditType: snapshot.auditType || DEFAULT_AUDIT_TYPE,
      scopeSections: snapshot.scopeSections || null,
      source: 'snapshot',
      frameworkVersion: snapshot.frameworkVersion || null,
      checklistVersion: snapshot.checklistVersion || null,
    };
  }

  const profile = { category: liveProp.category || null };
  for (const flag of SECTION_FACILITY_FLAGS) profile[flag] = Boolean(liveProp[flag]);
  for (const flag of DEPENDENCY_FLAGS) profile[flag] = liveProp[flag] === undefined ? true : Boolean(liveProp[flag]);
  return {
    profile,
    auditType: DEFAULT_AUDIT_TYPE,
    scopeSections: null,
    // Named so a reviewer can tell a reconstructed basis from a recorded one.
    source: 'live-property-fallback',
    frameworkVersion: null,
    checklistVersion: null,
  };
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
