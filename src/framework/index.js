// Single import surface for the Specula scoring framework.
//
// Nothing in the app imports this yet: Phase 1 builds and proves the engine
// without changing the auditor's screen. Phase 4 switches the console's live
// score over to score(), and Phase 6 adds certify() at publish time.

export { FRAMEWORK, FRAMEWORK_VERSION, CHECKLIST_VERSION } from './version.js';
export * from './weights.js';
export { ITEM_META } from './items.js';
export {
  CATALOG_SECTIONS,
  catalogItems,
  catalogIndex,
  applicableItems,
  isApplicable,
  rankOf,
} from './catalog.js';
export {
  deriveFinding,
  derivedSeverity,
  worstStatus,
  stepDown,
  stepUp,
  zeroToleranceProblems,
  InvalidEscalationError,
} from './findings.js';
export {
  buildSnapshot,
  resolveScoringProfile,
  isUsableSnapshot,
  snapshotDrift,
  isFavourableChange,
  isFavourableScopeChange,
  FACILITY_FLAGS,
} from './snapshot.js';
export {
  itemChangeIsMaterial,
  severityChangeIsMaterial,
  trailEntry,
  snapshotTrailEntries,
  TRAIL_ACTION,
} from './trail.js';
export { score } from './scoring.js';
export { certify } from './certification.js';
export { validateFramework, assertFrameworkValid } from './validate.js';

// Fail loudly in development the moment the checklist and the framework drift.
if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
  const { assertFrameworkValid } = await import('./validate.js');
  assertFrameworkValid();
} else if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  const { assertFrameworkValid } = await import('./validate.js');
  assertFrameworkValid();
}
