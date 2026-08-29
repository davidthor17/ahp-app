// The v1.0 catalogue.
//
// src/auditItems.js is the single authoritative source: the same 147 items the
// auditor captures are the items the framework scores. Nothing here re-lists an
// item id by hand, so the two cannot drift. If an item is added to
// auditItems.js without metadata in items.js, validate.js fails.
//
// Until Phase 3B the five Foundation items lived in a staging module and were
// composed in here, because they had no capture UI. They are now part of the
// live checklist and that staging module is gone, so this is a plain re-export.

import { SECTIONS } from '../auditItems.js';
import { ITEM_META } from './items.js';
import { CLASS_WEIGHT, STAR_RANK, DEFAULT_RANK } from './weights.js';

/** The v1.0 catalogue, identical to the live capture checklist. */
export const CATALOG_SECTIONS = SECTIONS;

/**
 * Flat list of every catalogue item joined to its framework metadata.
 * Items with no metadata are still returned, with `meta` null, so validate.js
 * can report them rather than the engine silently skipping them.
 */
export function catalogItems(sections = CATALOG_SECTIONS) {
  const out = [];
  for (const section of sections) {
    for (const item of section.items) {
      const meta = ITEM_META[item.id] || null;
      out.push({
        id: item.id,
        label: item.label,
        minStars: item.minStars,
        sectionId: section.id,
        sectionLabel: section.label,
        facility: section.facility || null,
        // The sub-feature this one item needs, if any. Carried through here
        // because isApplicable is handed the joined item, not the raw one.
        requires: item.requires || null,
        meta,
        weight: meta ? CLASS_WEIGHT[meta.weightClass] : null,
      });
    }
  }
  return out;
}

/** Index of catalogue items by id. */
export function catalogIndex(sections = CATALOG_SECTIONS) {
  const index = new Map();
  for (const item of catalogItems(sections)) index.set(item.id, item);
  return index;
}

/** Numeric rank for a property category, defaulting to 4 as App.jsx does. */
export function rankOf(profile = {}) {
  return STAR_RANK[profile.category] || DEFAULT_RANK;
}

/**
 * Is this item in scope for this property?
 *
 * Four gates, in order of how coarse they are:
 *   facility    the whole section needs a facility, e.g. the spa
 *   requires    this one item needs a sub-feature, e.g. a sauna inside the spa
 *   minStars    the item is above the property's category
 *   scope       a Spot Audit declared which sections it covers
 *
 * The `requires` gate exists because a handful of items grade the quality of
 * something that may simply not be there. Without it, a spa with no sauna had
 * to record SP-04 as not applicable, which then counted against the Foundation
 * assessment allowance and could cost the property its certification. An item
 * that does not apply should never have been an item, not an excused one.
 *
 * A missing flag is treated as present. That is deliberate: it keeps every
 * audit recorded before these flags existed scoring exactly as it did.
 */
export function isApplicable(item, profile = {}, scopeSections = null) {
  if (item.facility && !profile[item.facility]) return false;
  if (item.requires && profile[item.requires] === false) return false;
  if (item.minStars > rankOf(profile)) return false;
  if (scopeSections && !scopeSections.includes(item.sectionId)) return false;
  return true;
}

/** Items in scope for a property, in catalogue order. */
export function applicableItems(profile = {}, options = {}) {
  const { sections = CATALOG_SECTIONS, scopeSections = null } = options;
  return catalogItems(sections).filter((item) => isApplicable(item, profile, scopeSections));
}
