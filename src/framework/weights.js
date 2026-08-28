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

// Value contributed to the numerator. N/A has no value because it leaves the
// scope entirely: it is removed from the numerator AND the denominator.
export const STATUS_VALUE = Object.freeze({
  [STATUS.MET]: 1,
  [STATUS.PARTIAL]: 0.5,
  [STATUS.MISSED]: 0,
});

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

export const NO_CERTIFICATION = Object.freeze({ id: 'none', label: 'No certification' });
