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
export function isApplicable(item, profile = {}, scopeSections = null, checklistItems = null) {
  if (!inChecklist(item.id, checklistItems)) return false;
  if (item.facility && !profile[item.facility]) return false;
  if (item.requires && profile[item.requires] === false) return false;
  if (item.minStars > rankOf(profile)) return false;
  if (scopeSections && !scopeSections.includes(item.sectionId)) return false;
  return true;
}

/**
 * The fifth gate, and the only one that looks backwards rather than at the
 * property: was this item on the checklist when the audit's basis froze?
 *
 * Phase 5.8 P0-B. The other four gates are evaluated against today's
 * catalogue, so an audit's scope grew every time src/auditItems.js grew. The
 * frozen basis did not stop it: it pins the category, the facility profile,
 * the audit type and the scope sections, but never which items exist.
 * checklist_version was recorded on the row and never read by anything.
 * AHP-2026-D699 showed 71 of 71 when it was captured and 71 of 107 today,
 * having not itself changed at all.
 *
 * A null pin means the basis predates this, and applicability is read live.
 * That is what every existing audit does and must keep doing. Accepts an
 * array, which is how it comes back from JSONB, or a Set, which is what a
 * render loop should hand it.
 */
export function inChecklist(itemId, checklistItems = null) {
  if (!checklistItems) return true;
  // An empty pin is no pin. It has to be said here as well as in normalisePin,
  // because an empty array is truthy: without this line a pin that arrived
  // empty, from a hand-edited row or a bad write, would silently report that
  // no item applies and empty the audit rather than fail loudly. The safe
  // reading of "I have no list" is always the unpinned one.
  const size = typeof checklistItems.size === 'number' ? checklistItems.size : checklistItems.length;
  if (!size) return true;
  return typeof checklistItems.has === 'function'
    ? checklistItems.has(itemId)
    : checklistItems.includes(itemId);
}

/** Items in scope for a property, in catalogue order. */
export function applicableItems(profile = {}, options = {}) {
  const { sections = CATALOG_SECTIONS, scopeSections = null, checklistItems = null } = options;
  // Asked once per item per score, so the pin is normalised to a Set first.
  const pin = checklistItems && typeof checklistItems.has !== 'function'
    ? new Set(checklistItems)
    : checklistItems;
  return catalogItems(sections).filter((item) => isApplicable(item, profile, scopeSections, pin));
}
