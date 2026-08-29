// Constants for the scoring engine. Everything a calibration change would
// touch lives here, separate from the 147 rows of per-item metadata, so that
// re-tuning the framework is a diff a reviewer can read in one screen.

// ── Weight classes ──────────────────────────────────────────────────────────
export const WEIGHT_CLASS = Object.freeze({
  FOUNDATION: 'foundation',
  STANDARD: 'standard',
  DISTINCTION: 'distinction',
});

export const CLASS_WEIGHT = Object.freeze({
  [WEIGHT_CLASS.FOUNDATION]: 3,
  [WEIGHT_CLASS.STANDARD]: 2,
  [WEIGHT_CLASS.DISTINCTION]: 1,
});

export const WEIGHT_CLASSES = Object.freeze(Object.values(WEIGHT_CLASS));

// ── Assessment statuses ─────────────────────────────────────────────────────
export const STATUS = Object.freeze({
  MET: 'met',
  PARTIAL: 'partial',
  MISSED: 'missed',
  NA: 'na',
});

export const STATUSES = Object.freeze(Object.values(STATUS));

// Value contributed to the numerator. N/A has no value: what it does to the
// denominators depends on which kind of N/A it is, see NA_REASON below.
export const STATUS_VALUE = Object.freeze({
  [STATUS.MET]: 1,
  [STATUS.PARTIAL]: 0.5,
  [STATUS.MISSED]: 0,
});

// ── Not applicable ──────────────────────────────────────────────────────────
// N/A carried two incompatible meanings and the engine modelled only one, which
// made it a free eraser for poor performance. It is now two outcomes.
//
//   structural     the property does not have this at all, so the item leaves
//                  the audit entirely. Capped, because this is the erasing kind.
//   observational  it exists but could not be assessed on this stay. The item
//                  stays in scope and counts as unassessed, so coverage falls.
//                  Uncapped, because the coverage floors already handle it.
export const NA_REASON = Object.freeze({
  NOT_OFFERED: 'not_offered',   // the property does not provide this service
  NOT_PRESENT: 'not_present',   // the facility or feature does not exist
  NOT_OBSERVED: 'not_observed', // available, but not seen on this stay
});

export const NA_REASONS = Object.freeze(Object.values(NA_REASON));

export const STRUCTURAL_NA_REASONS = Object.freeze([
  NA_REASON.NOT_OFFERED,
  NA_REASON.NOT_PRESENT,
]);

// An N/A recorded before reasons existed. Read as observational, the
// conservative choice: it can only lower a historical score, never raise one.
export const LEGACY_NA_REASON = NA_REASON.NOT_OBSERVED;

// Structural N/A may not exceed this share of applicable weight. Measured by
// weight rather than item count so that erasing Foundation items costs more
// than erasing Distinction items. Breaching it blocks certification outright.
export const STRUCTURAL_NA_CAP_PCT = 5;

// Statuses that count as "the auditor made a determination that is scored".
export const GRADED_STATUSES = Object.freeze([STATUS.MET, STATUS.PARTIAL, STATUS.MISSED]);

// When one item carries different statuses across shifts, the worst one wins.
// This preserves the behaviour the console has always had.
export const STATUS_SEVERITY_ORDER = Object.freeze({
  [STATUS.MET]: 0,
  [STATUS.NA]: 1,
  [STATUS.PARTIAL]: 2,
  [STATUS.MISSED]: 3,
});

// ── Finding severities ──────────────────────────────────────────────────────
export const SEVERITY = Object.freeze({
  MINOR: 'minor',
  MAJOR: 'major',
  CRITICAL: 'critical',
  ZERO_TOLERANCE: 'zero_tolerance',
});

// Severities an item may carry as its default. Zero Tolerance is deliberately
// absent: it is never a default, only an explicit auditor escalation.
export const DEFAULT_SEVERITIES = Object.freeze([
  SEVERITY.MINOR,
  SEVERITY.MAJOR,
  SEVERITY.CRITICAL,
]);

// Ordered weakest to strongest, used for the Partial step-down.
export const SEVERITY_LADDER = Object.freeze([
  SEVERITY.MINOR,
  SEVERITY.MAJOR,
  SEVERITY.CRITICAL,
]);

// ── Reporting dimensions ────────────────────────────────────────────────────
export const DIMENSION = Object.freeze({
  CONDITION: 'condition',
  SERVICE: 'service',
  PRODUCT: 'product',
  EXPERIENCE: 'experience',
});

export const DIMENSIONS = Object.freeze(Object.values(DIMENSION));

// ── Property categories ─────────────────────────────────────────────────────
// Mirrors STAR_RANK in App.jsx. An item is applicable when its minStars is at
// or below the property's rank.
export const STAR_RANK = Object.freeze({ '4★': 4, '5★': 5, 'Ultra': 6 });
export const DEFAULT_RANK = 4;

// ── Audit types ─────────────────────────────────────────────────────────────
// Mirrors the tier check constraint on audits.tier. Audit type says how deeply
// the property was assessed; the certification level says how well it
// performed. They are separate axes, but the type caps how high the level can
// reach.
export const AUDIT_TYPE = Object.freeze({ DESK: 'desk', SPOT: 'spot', FULL: 'full' });
export const AUDIT_TYPES = Object.freeze(Object.values(AUDIT_TYPE));

// Matches the default on audits.tier, so an audit that never had a type set
// is treated the way the database already treats it.
export const DEFAULT_AUDIT_TYPE = AUDIT_TYPE.FULL;

// Property categories that may reach the top level. At 4★ the checklist
// offers two Distinction items, so an Elite award there would certify
// flawlessness rather than distinction.
export const ELITE_CATEGORIES = Object.freeze(['5★', 'Ultra']);

// ── Certification thresholds ────────────────────────────────────────────────
// Ordered weakest to strongest. Evaluation walks the list and keeps the
// highest level whose every condition is satisfied.
//
// v1 deliberately has no Major finding cap. Critical findings and Zero
// Tolerance triggers block; Major findings are reported prominently and are
// left to be calibrated once there is more real audit data.
export const CERTIFICATION_LEVELS = Object.freeze([
  Object.freeze({
    id: 'certified',
    label: 'Specula Certified',
    minOverall: 85,
    minFoundation: 90,
    minCoverage: 80,
    auditTypes: Object.freeze([AUDIT_TYPE.SPOT, AUDIT_TYPE.FULL]),
    categories: null, // any
  }),
  Object.freeze({
    id: 'exceptional',
    label: 'Specula Exceptional',
    minOverall: 90,
    minFoundation: 95,
    minCoverage: 90,
    auditTypes: Object.freeze([AUDIT_TYPE.FULL]),
    categories: null,
  }),
  Object.freeze({
    id: 'elite',
    label: 'Specula Elite',
    minOverall: 95,
    minFoundation: 95,
    minCoverage: 95,
    auditTypes: Object.freeze([AUDIT_TYPE.FULL]),
    categories: ELITE_CATEGORIES,
  }),
]);

// ── Foundation assessment completeness ──────────────────────────────────────
//
// How many applicable fundamentals may go unassessed at each level. Counted in
// items, not as a percentage: every Foundation item weighs exactly 3, so the
// two are equivalent, and a percentage punishes a small property for being
// small. Three unexamined fundamentals is 8.8% of a 34-item pool and 15% of a
// 20-item pool; the same three should mean the same thing at both.
//
// This is a completeness requirement, not a score penalty. A property is not
// being marked down, it is being told the audit is not finished.
export const FOUNDATION_ALLOWANCE = Object.freeze({
  certified: 3,
  exceptional: 1,
  elite: 0,
});

// ── Spot Audit certification scope ──────────────────────────────────────────
//
// A Spot Audit measures coverage against its declared scope, which makes a
// narrow scope easy to score well on. These sections carry 11 fundamentals
// between them at every property profile, because none of the three is behind
// a facility gate, so the core guarantees the right fundamentals rather than
// merely enough of them.
export const SPOT_CORE_SECTIONS = Object.freeze(['room', 'bathroom', 'safety']);
export const SPOT_MIN_ADDITIONAL_SECTIONS = 2;

export const NO_CERTIFICATION = Object.freeze({ id: 'none', label: 'No certification' });
