// Structural validation of the framework against the authoritative catalogue.
//
// Everything here is derived from auditItems.js. No second
// hand-written list of item ids exists anywhere in the framework, so the only
// way for metadata and checklist to disagree is for one of them to change,
// and this file fails loudly when they do.
//
// Run in tests, and at import time in development via index.js.

import {
  WEIGHT_CLASSES,
  CLASS_WEIGHT,
  DEFAULT_SEVERITIES,
  DIMENSIONS,
} from './weights.js';
import { FRAMEWORK } from './version.js';
import { CATALOG_SECTIONS, catalogItems } from './catalog.js';
import { ITEM_META } from './items.js';

/**
 * @returns {{ ok: boolean, errors: string[], stats: object }}
 */
export function validateFramework(options = {}) {
  const {
    sections = CATALOG_SECTIONS,
    meta = ITEM_META,
    expected = FRAMEWORK,
  } = options;

  const errors = [];
  const seen = new Map();

  // ── Every catalogue item has complete, valid metadata, exactly once ───────
  for (const section of sections) {
    if (!Array.isArray(section.items)) {
      errors.push(`section "${section.id}" has no items array`);
      continue;
    }
    for (const item of section.items) {
      if (seen.has(item.id)) {
        errors.push(`item "${item.id}" appears twice in the catalogue: sections "${seen.get(item.id)}" and "${section.id}"`);
        continue;
      }
      seen.set(item.id, section.id);

      const m = meta[item.id];
      if (!m) {
        errors.push(`item "${item.id}" (${section.id}) exists in the audit but has no framework metadata`);
        continue;
      }
      if (!m.weightClass) {
        errors.push(`item "${item.id}" has no weight class`);
      } else if (!WEIGHT_CLASSES.includes(m.weightClass)) {
        errors.push(`item "${item.id}" has invalid weight class "${m.weightClass}"`);
      }
      if (!m.defaultSeverity) {
        errors.push(`item "${item.id}" has no default severity`);
      } else if (!DEFAULT_SEVERITIES.includes(m.defaultSeverity)) {
        errors.push(`item "${item.id}" has invalid default severity "${m.defaultSeverity}" (zero_tolerance may never be a default)`);
      }
      if (!m.dimension) {
        errors.push(`item "${item.id}" has no dimension`);
      } else if (!DIMENSIONS.includes(m.dimension)) {
        errors.push(`item "${item.id}" has invalid dimension "${m.dimension}"`);
      }
      if (typeof m.zeroToleranceEligible !== 'boolean') {
        errors.push(`item "${item.id}" has a non-boolean zeroToleranceEligible`);
      }
      if (typeof item.minStars !== 'number') {
        errors.push(`item "${item.id}" has no numeric minStars`);
      }
    }
  }

  // ── No orphan metadata ───────────────────────────────────────────────────
  for (const id of Object.keys(meta)) {
    if (!seen.has(id)) {
      errors.push(`framework metadata exists for "${id}" but no such item exists in the audit`);
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const items = catalogItems(sections);
  const itemCount = items.length;
  const sectionCount = sections.length;
  const theoreticalWeight = items.reduce((a, i) => a + (i.weight || 0), 0);

  if (itemCount !== expected.expectedItemCount) {
    errors.push(`item count is ${itemCount}, expected ${expected.expectedItemCount}`);
  }
  if (sectionCount !== expected.expectedSectionCount) {
    errors.push(`section count is ${sectionCount}, expected ${expected.expectedSectionCount}`);
  }
  if (theoreticalWeight !== expected.expectedTheoreticalWeight) {
    errors.push(`theoretical weight is ${theoreticalWeight}, expected ${expected.expectedTheoreticalWeight}`);
  }

  const byClass = {};
  for (const c of WEIGHT_CLASSES) {
    const list = items.filter((i) => i.meta && i.meta.weightClass === c);
    byClass[c] = { items: list.length, weight: list.length * CLASS_WEIGHT[c] };
  }
  const byDimension = {};
  for (const d of DIMENSIONS) {
    const list = items.filter((i) => i.meta && i.meta.dimension === d);
    byDimension[d] = { items: list.length, weight: list.reduce((a, i) => a + (i.weight || 0), 0) };
  }
  const bySeverity = {};
  for (const s of DEFAULT_SEVERITIES) {
    bySeverity[s] = items.filter((i) => i.meta && i.meta.defaultSeverity === s).length;
  }

  const classWeightSum = Object.values(byClass).reduce((a, c) => a + c.weight, 0);
  if (classWeightSum !== theoreticalWeight) {
    errors.push(`weight class totals sum to ${classWeightSum} but the catalogue weighs ${theoreticalWeight}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      frameworkVersion: expected.frameworkVersion,
      checklistVersion: expected.checklistVersion,
      sections: sectionCount,
      items: itemCount,
      theoreticalWeight,
      byClass,
      byDimension,
      bySeverity,
      zeroToleranceEligible: items.filter((i) => i.meta && i.meta.zeroToleranceEligible).length,
    },
  };
}

/** Throwing form, for use at import time and in tests. */
export function assertFrameworkValid(options = {}) {
  const result = validateFramework(options);
  if (!result.ok) {
    throw new Error(
      `Specula framework validation failed with ${result.errors.length} error(s):\n  - ${result.errors.join('\n  - ')}`,
    );
  }
  return result;
}
