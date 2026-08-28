// Per-item framework metadata for all 147 catalogue items.
//
// Keyed by item id. The catalogue itself lives in auditItems.js; this file says
// only what each item is worth, what it reports into, and how bad it is when it
// fails.
//
//   weightClass      foundation x3 / standard x2 / distinction x1
//   dimension        condition / service / product / experience
//   defaultSeverity  the finding raised when the item is Missed. A Partial
//                    steps this down one level. Never zero_tolerance.
//   zeroToleranceEligible
//                    the auditor MAY escalate a Missed on this item to Zero
//                    Tolerance, with a note and evidence. Never automatic.
//   note             recorded only where the classification was not obvious
//
// Weight class and severity are deliberately independent. FBS-09 is
// Foundation x3 because billing accuracy is a trust fundamental, yet only
// Major by default because one arithmetic slip is not a scandal. BRK-08 is
// Standard x2 yet Major, because for a coeliac guest it is a health matter.

import { WEIGHT_CLASS, SEVERITY, DIMENSION } from './weights.js';

const F = WEIGHT_CLASS.FOUNDATION;
const S = WEIGHT_CLASS.STANDARD;
const D = WEIGHT_CLASS.DISTINCTION;
const MINOR = SEVERITY.MINOR;
const MAJOR = SEVERITY.MAJOR;
const CRITICAL = SEVERITY.CRITICAL;
const CONDITION = DIMENSION.CONDITION;
const SERVICE = DIMENSION.SERVICE;
const PRODUCT = DIMENSION.PRODUCT;
const EXPERIENCE = DIMENSION.EXPERIENCE;

// weightClass, dimension, defaultSeverity, zeroToleranceEligible, note
const item = (weightClass, dimension, defaultSeverity, zeroToleranceEligible = false, note = '') =>
  ({ weightClass, dimension, defaultSeverity, zeroToleranceEligible, note });

export const ITEM_META = {

  // Pre-Arrival & Website
  'PRE-01': item(S, EXPERIENCE, MINOR),
  'PRE-02': item(S, PRODUCT, MINOR, false, 'Quality of the imagery, not its accuracy. Photography that materially misrepresents the property is a trust failure with no item of its own; see gaps.'),
  'PRE-03': item(S, SERVICE, MAJOR, false, 'Booking friction is Standard, but opaque pricing touches trust, so Major rather than Minor.'),
  'PRE-04': item(S, PRODUCT, MINOR),
  'PRE-05': item(S, EXPERIENCE, MINOR),
  'PRE-06': item(D, EXPERIENCE, MINOR),
  'PRE-07': item(D, SERVICE, MINOR),
  'PRE-08': item(S, EXPERIENCE, MINOR),
  'PRE-09': item(S, PRODUCT, MINOR, false, 'The website is the product being assessed here, not the brand feeling, so Product rather than Experience.'),
  'PRE-10': item(S, SERVICE, MAJOR, false, 'A guest who cannot reach the property by phone is a failure of the basic promise, not a polish issue.'),
  'PRE-11': item(S, SERVICE, MAJOR),
  'PRE-12': item(D, EXPERIENCE, MINOR, false, 'Distinction despite minStars 4. Social presence is a marketing signal with little bearing on the stay itself; see risks.'),
  'PRE-13': item(D, SERVICE, MINOR),

  // Arrival & Entrance
  'ARR-01': item(F, CONDITION, MAJOR),
  'ARR-02': item(S, SERVICE, MAJOR),
  'ARR-03': item(S, SERVICE, MINOR),
  'ARR-04': item(S, EXPERIENCE, MINOR, false, 'Engineered atmosphere, so Experience. Temperature that is genuinely uncomfortable should be escalated to Major.'),
  'ARR-05': item(S, SERVICE, MINOR),
  'ARR-06': item(D, EXPERIENCE, MINOR),
  'ARR-07': item(D, EXPERIENCE, MINOR),
  'ARR-08': item(F, CONDITION, CRITICAL, true, 'The only accessibility item in the checklist. A guest unable to enter is a core-promise and dignity failure, and Zero Tolerance if the property misrepresents its access.'),
  'ARR-09': item(S, CONDITION, MINOR, false, 'Escalate to Major where poor lighting creates a trip or stair hazard.'),
  'ARR-10': item(F, CONDITION, MAJOR, false, 'Escalate to Critical where damaged furniture is a physical hazard.'),
  'ARR-11': item(S, CONDITION, MINOR, false, 'Cleanliness, but low consequence, so Standard weight rather than Foundation.'),
  'ARR-12': item(S, EXPERIENCE, MINOR),

  // Reception & Check-in
  'REC-01': item(S, SERVICE, MAJOR),
  'REC-02': item(S, SERVICE, MINOR),
  'REC-03': item(S, SERVICE, MINOR, false, 'Warmth is graded across REC-02, REC-03 and DEP-03. Sustained coldness across all three should be read as Major at section level.'),
  'REC-04': item(S, SERVICE, MINOR),
  'REC-05': item(D, EXPERIENCE, MINOR),
  'REC-06': item(D, SERVICE, MINOR),
  'REC-07': item(D, SERVICE, MINOR),
  'REC-08': item(S, CONDITION, MINOR),
  'REC-09': item(S, SERVICE, MAJOR),
  'REC-10': item(S, SERVICE, MINOR),
  'REC-11': item(F, SERVICE, MAJOR, true),

  // Room Quality
  'RM-01': item(F, CONDITION, MAJOR, false, 'Dust is a cleanliness lapse without health consequence, so Major where RM-02 is Critical.'),
  'RM-02': item(F, CONDITION, CRITICAL, true, 'Zero Tolerance for bodily fluids, pests or evidence the room was not cleaned between guests.'),
  'RM-03': item(F, CONDITION, MAJOR),
  'RM-04': item(F, CONDITION, CRITICAL, true, 'Graded as hygiene rather than product. Linen not changed between guests is Zero Tolerance.'),
  'RM-05': item(S, CONDITION, MAJOR, false, 'Sleep is the core promise of a hotel room. Filed under Condition as an environmental attribute; a case exists for Product.'),
  'RM-06': item(S, PRODUCT, MINOR),
  'RM-07': item(D, EXPERIENCE, MINOR),
  'RM-08': item(D, EXPERIENCE, MINOR),
  'RM-09': item(S, CONDITION, MINOR),
  'RM-10': item(F, CONDITION, MAJOR, false, 'Foundation because an uncleared minibar is both a hygiene lapse and a billing-dispute risk.'),

  // Facilities
  'FAC-01': item(F, CONDITION, MAJOR, false, 'Duplicates ARR-01. Both currently feed the score; see risks.'),
  'FAC-02': item(F, CONDITION, MAJOR),
  'FAC-03': item(F, CONDITION, MAJOR),
  'FAC-04': item(S, PRODUCT, MAJOR, false, 'Escalate to Critical where equipment is unsafe. There is no property flag for a gym, so this is graded against properties without one.'),
  'FAC-05': item(S, SERVICE, MAJOR, false, 'Undisclosed charges are a trust failure, which is why this is Major rather than Minor.'),
  'FAC-06': item(D, PRODUCT, MINOR),

  // Safety, Security & Conduct
  'SAF-01': item(F, CONDITION, CRITICAL, true),
  'SAF-02': item(F, CONDITION, CRITICAL, true),
  'SAF-03': item(F, SERVICE, CRITICAL, true),

  // Bathroom
  'BTH-01': item(F, CONDITION, CRITICAL, true, 'Zero Tolerance for extensive mould, which is a health matter rather than a housekeeping one.'),
  'BTH-02': item(F, CONDITION, MAJOR, false, 'Escalate to Critical where water runs scalding or the temperature is unstable enough to burn.'),
  'BTH-03': item(F, CONDITION, MAJOR, false, 'Compound item: freshness is hygiene, quantity is service. Major by default, escalate to Critical or Zero Tolerance if linen is soiled or reused.'),
  'BTH-04': item(S, PRODUCT, MINOR),
  'BTH-05': item(S, PRODUCT, MINOR, false, 'Compound item: presence is Product, cleanliness is Condition. Escalate on the cleanliness limb.'),
  'BTH-06': item(S, PRODUCT, MINOR),
  'BTH-07': item(D, PRODUCT, MINOR),

  // Breakfast
  'BRK-01': item(F, CONDITION, CRITICAL, true, 'Food held outside safe temperature is a food-safety failure, not a quality one. Zero Tolerance where holding temperatures are clearly unsafe.'),
  'BRK-02': item(S, PRODUCT, MINOR),
  'BRK-03': item(S, PRODUCT, MINOR),
  'BRK-04': item(S, PRODUCT, MINOR),
  'BRK-05': item(S, SERVICE, MINOR),
  'BRK-06': item(S, PRODUCT, MINOR, false, 'Authenticity of the offer is graded as Product, following the worked example for RST-05.'),
  'BRK-07': item(S, PRODUCT, MAJOR, false, 'Mislabelling is worse than absence. A guest relying on a wrong label is a dietary-trust failure.'),
  'BRK-08': item(S, PRODUCT, MAJOR, false, 'Coeliac disease makes this a health matter, not a preference.'),
  'BRK-09': item(F, SERVICE, CRITICAL, true, 'Foundation and Critical. Zero Tolerance where a stated allergy is mishandled.'),
  'BRK-10': item(S, PRODUCT, MINOR),
  'BRK-11': item(S, SERVICE, MINOR),
  'BRK-12': item(D, EXPERIENCE, MINOR),
  'BRK-13': item(S, PRODUCT, MAJOR),
  'BRK-14': item(S, PRODUCT, MINOR),

  // Lunch & All-Day Dining
  'LUN-01': item(S, PRODUCT, MINOR),
  'LUN-02': item(F, CONDITION, MAJOR, true, 'Tired food is quality, spoiled food is safety. Major by default, Zero Tolerance where food is actually spoiled.'),
  'LUN-03': item(S, PRODUCT, MINOR),
  'LUN-04': item(S, PRODUCT, MINOR),
  'LUN-05': item(S, PRODUCT, MAJOR, false, 'Same health reasoning as BRK-08.'),
  'LUN-06': item(S, PRODUCT, MINOR, false, 'Authenticity of the offer graded as Product, per RST-05.'),
  'LUN-07': item(S, PRODUCT, MINOR),
  'LUN-08': item(D, PRODUCT, MINOR),
  'LUN-09': item(D, EXPERIENCE, MINOR, false, 'Kept in Experience: open kitchen is theatre rather than a property of the food.'),
  'LUN-10': item(S, CONDITION, MINOR, false, 'A cleanliness item, but too low-consequence for Foundation weight.'),

  // Restaurant & Dinner
  'RST-01': item(F, CONDITION, CRITICAL, true),
  'RST-02': item(S, PRODUCT, MINOR),
  'RST-03': item(S, PRODUCT, MINOR),
  'RST-04': item(S, PRODUCT, MINOR),
  'RST-05': item(S, PRODUCT, MAJOR, false, 'Follows your worked example: core product quality and authenticity matter to the positioning, but failure is not a safety issue.'),
  'RST-06': item(S, PRODUCT, MAJOR, false, 'Same reasoning as RST-05, which it largely restates.'),
  'RST-07': item(D, PRODUCT, MINOR),
  'RST-08': item(D, SERVICE, MINOR),
  'RST-09': item(S, PRODUCT, MINOR),
  'RST-10': item(D, PRODUCT, MINOR),
  'RST-11': item(D, PRODUCT, MINOR, false, 'A credential attaching to the offer, so Product rather than Experience.'),
  'RST-12': item(F, CONDITION, CRITICAL, true, 'Undercooked poultry, pork or egg is a food-safety failure and Zero Tolerance eligible.'),

  // F&B Service
  'FBS-01': item(S, SERVICE, MINOR),
  'FBS-02': item(S, SERVICE, MINOR),
  'FBS-03': item(S, SERVICE, MAJOR, false, 'Menu knowledge is the first line of allergen handling, which lifts it above Minor.'),
  'FBS-04': item(F, SERVICE, CRITICAL, true, 'Your second worked example: Foundation weight and Critical severity, Zero Tolerance where a declared allergy is mishandled.'),
  'FBS-05': item(S, SERVICE, MINOR),
  'FBS-06': item(S, SERVICE, MINOR),
  'FBS-07': item(S, SERVICE, MINOR),
  'FBS-08': item(S, SERVICE, MAJOR),
  'FBS-09': item(F, SERVICE, MAJOR, true, 'The clearest case of weight and severity diverging. Foundation weight because billing accuracy is a trust fundamental, but a single arithmetic slip is Major. Deliberate or systematic overcharging is Zero Tolerance.'),
  'FBS-10': item(S, SERVICE, MINOR, false, 'Tone of a human interaction, so Service rather than Experience.'),

  // Pool
  'PL-01': item(S, PRODUCT, MINOR),
  'PL-02': item(S, CONDITION, MINOR),
  'PL-03': item(F, CONDITION, CRITICAL, true, 'Water chemistry is a health matter. Zero Tolerance where readings are clearly unsafe.'),
  'PL-04': item(S, PRODUCT, MINOR),
  'PL-05': item(S, SERVICE, MINOR),
  'PL-06': item(S, SERVICE, MAJOR, false, 'Major rather than Minor because attendance carries a supervision function.'),
  'PL-07': item(D, SERVICE, MINOR),
  'PL-08': item(D, PRODUCT, MINOR),
  'PL-09': item(F, CONDITION, CRITICAL),
  'PL-10': item(F, CONDITION, CRITICAL, true, 'Water you cannot see the bottom of is a drowning risk, not an aesthetic one.'),
  'PL-11': item(D, PRODUCT, MINOR, false, 'Should be conditional on property positioning. An adults-only property is currently marked down for correctly having no splash area.'),
  'PL-12': item(D, PRODUCT, MINOR, false, 'The label already says "if applicable". Where a slide exists but is out of service, escalate to Major.'),

  // Spa & Wellness
  'SP-01': item(S, EXPERIENCE, MINOR),
  'SP-02': item(F, CONDITION, MAJOR),
  'SP-03': item(F, CONDITION, MAJOR, false, 'Unpleasant rather than unsafe, so Major where bathroom mould is Critical.'),
  'SP-04': item(F, CONDITION, MAJOR, false, 'Escalate to Critical where the sauna overheats or cannot be exited safely. Depends on SP-09 establishing a sauna exists.'),
  'SP-05': item(S, SERVICE, MINOR),
  'SP-06': item(S, PRODUCT, MINOR),
  'SP-07': item(D, PRODUCT, MINOR),
  'SP-08': item(D, EXPERIENCE, MINOR),
  'SP-09': item(S, PRODUCT, MINOR),
  'SP-10': item(S, CONDITION, MINOR, false, 'Lighting graded as environment under Condition, consistent with ARR-09.'),
  'SP-11': item(S, PRODUCT, MINOR),
  'SP-12': item(S, SERVICE, MAJOR, false, 'Conditional item: should be N/A unless a treatment was actually received.'),
  'SP-13': item(F, SERVICE, CRITICAL, true),

  // Housekeeping
  'HK-01': item(S, SERVICE, MAJOR),
  'HK-02': item(S, CONDITION, MINOR),
  'HK-03': item(F, SERVICE, CRITICAL, true, 'The only privacy and trust item in the checklist. Zero Tolerance for theft or tampering with guest property.'),
  'HK-04': item(S, SERVICE, MINOR),
  'HK-05': item(S, SERVICE, MINOR),
  'HK-06': item(D, EXPERIENCE, MINOR),
  'HK-07': item(D, EXPERIENCE, MINOR),

  // Departure
  'DEP-01': item(F, SERVICE, CRITICAL, true, 'Billing is where trust is finally tested. Zero Tolerance for charges the guest did not incur.'),
  'DEP-02': item(S, SERVICE, MINOR),
  'DEP-03': item(S, SERVICE, MINOR),
  'DEP-04': item(S, SERVICE, MINOR),
  'DEP-05': item(S, EXPERIENCE, MINOR),
  'DEP-06': item(D, EXPERIENCE, MINOR),
  'DEP-07': item(D, EXPERIENCE, MINOR),
};

export default ITEM_META;
