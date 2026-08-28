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

// ── Certification thresholds ────────────────────────────────────────────────
// Ordered weakest to strongest. Evaluation walks the list and keeps the
// highest level whose every condition is satisfied.
export const CERTIFICATION_LEVELS = Object.freeze([
  Object.freeze({ id: 'certified',   label: 'Specula Certified',   minOverall: 85, minFoundation: 90 }),
  Object.freeze({ id: 'exceptional', label: 'Specula Exceptional', minOverall: 90, minFoundation: 95 }),
  Object.freeze({ id: 'elite',       label: 'Specula Elite',       minOverall: 95, minFoundation: 95 }),
]);

export const NO_CERTIFICATION = Object.freeze({ id: 'none', label: 'No certification' });
