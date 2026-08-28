// Specula Scoring & Certification Framework — version identity.
//
// Both identifiers are stamped onto an audit when it is published so that a
// report is always interpretable against the rules that produced it. Bump
// FRAMEWORK_VERSION when the arithmetic, severities or thresholds change;
// bump CHECKLIST_VERSION when items are added, removed or reworded.

export const FRAMEWORK_VERSION = '1.0.0';

// The checklist this framework's metadata is written against. '1.0.0' is the
// 147-item catalogue: the 142 items live in the console plus the five
// Foundation items staged in additions.js.
export const CHECKLIST_VERSION = '1.0.0';

export const FRAMEWORK = Object.freeze({
  name: 'Specula Scoring & Certification Framework',
  frameworkVersion: FRAMEWORK_VERSION,
  checklistVersion: CHECKLIST_VERSION,
  expectedItemCount: 147,
  expectedSectionCount: 15,
  expectedTheoreticalWeight: 298,
});
