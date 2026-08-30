// Specula Scoring & Certification Framework — version identity.
//
// Both identifiers are stamped onto an audit when it is published so that a
// report is always interpretable against the rules that produced it. Bump
// FRAMEWORK_VERSION when the arithmetic, severities or thresholds change;
// bump CHECKLIST_VERSION when items are added, removed or reworded.
//
// Both sat at 1.0.0 through three changes that the comment above says should
// have moved them. Corrected before the first audit is stamped in production,
// because an audit stamped with the wrong version cannot be re-stamped
// honestly afterwards.
//
//   FRAMEWORK 1.0.0  the original weighted model
//             1.1.0  denominator confirmed, coverage floors, audit type and
//                    category gates
//             1.2.0  N/A split into structural and observational with a cap,
//                    Partial on a Critical item stays Critical, no downward
//                    severity path, typed assessment outcomes
//             1.3.0  Foundation assessment allowance, Spot Audit core,
//                    item-level dependency gating
//
//   CHECKLIST 1.0.0  the original 142 items in 14 sections
//             1.1.0  five Foundation items promoted, Safety, Security &
//                    Integrity added, 147 items in 15 sections
//             1.2.0  PL-03 reworded from chlorine to sanitiser, eight items
//                    gated on a property sub-feature

export const FRAMEWORK_VERSION = '1.3.0';

// The checklist this framework's metadata is written against: the 147-item
// catalogue in auditItems.js, which the console captures in full.
export const CHECKLIST_VERSION = '1.2.0';

export const FRAMEWORK = Object.freeze({
  name: 'Specula Scoring & Certification Framework',
  frameworkVersion: FRAMEWORK_VERSION,
  checklistVersion: CHECKLIST_VERSION,
  expectedItemCount: 147,
  expectedSectionCount: 15,
  expectedTheoreticalWeight: 298,
});
