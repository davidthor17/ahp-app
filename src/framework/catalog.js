// The v1.0 catalogue: the live checklist composed with the staged additions.
//
// SECTIONS is the authoritative source. Nothing here re-lists item ids by
// hand, so the framework cannot drift from the console: if an item is added
// to auditItems.js and not to items.js, validate.js fails.
//
// Phase 1 note: the console renders SECTIONS (142 items). The framework scores
// against CATALOG_SECTIONS (147). Phase 2 promotes additions.js into
// auditItems.js, at which point the two become the same list.

import { SECTIONS } from '../auditItems.js';
import { NEW_SECTIONS, NEW_ITEMS } from './additions.js';
import { ITEM_META } from './items.js';
import { CLASS_WEIGHT, STAR_RANK, DEFAULT_RANK } from './weights.js';

/** The 142 items as the auditor sees them today. */
export const LIVE_SECTIONS = SECTIONS;

/** The 147-item v1.0 catalogue: live sections plus staged additions. */
export const CATALOG_SECTIONS = buildCatalog();

function buildCatalog() {
  const byId = new Map(NEW_ITEMS.reduce((acc, entry) => {
    const list = acc.find(([id]) => id === entry.sectionId);
    if (list) list[1].push(entry.item); else acc.push([entry.sectionId, [entry.item]]);
    return acc;
  }, []));

  const out = [];
  for (const section of SECTIONS) {
    const extra = byId.get(section.id) || [];
    out.push(extra.length ? { ...section, items: [...section.items, ...extra] } : section);
    for (const added of NEW_SECTIONS) {
      if (added.insertAfter === section.id) {
        const { insertAfter, ...rest } = added;
        out.push(rest);
      }
    }
  }
  // Any new section whose anchor does not exist is appended rather than lost.
  for (const added of NEW_SECTIONS) {
    if (!out.some((s) => s.id === added.id)) {
      const { insertAfter, ...rest } = added;
      out.push(rest);
    }
  }
  return out;
}

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
 * Facility must be present, and minStars at or below the property's rank.
 * `scopeSections` narrows the scope further, for a Spot Audit that declares
 * which sections it covers.
 */
export function isApplicable(item, profile = {}, scopeSections = null) {
  if (item.facility && !profile[item.facility]) return false;
  if (item.minStars > rankOf(profile)) return false;
  if (scopeSections && !scopeSections.includes(item.sectionId)) return false;
  return true;
}

/** Items in scope for a property, in catalogue order. */
export function applicableItems(profile = {}, options = {}) {
  const { sections = CATALOG_SECTIONS, scopeSections = null } = options;
  return catalogItems(sections).filter((item) => isApplicable(item, profile, scopeSections));
}
