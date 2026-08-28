// Five Foundation items the mapping analysis found genuinely absent from the
// 142-item checklist, staged here rather than merged into auditItems.js.
//
// Phase 1 builds and proves the framework without touching the auditor's
// screen: the console still renders the 142 items in SECTIONS, while the
// framework scores and validates against the composed 147-item catalogue in
// catalog.js. Phase 2 promotes these into auditItems.js and deletes this file.
//
// Each concept was checked against all 142 existing labels before being added:
//   SAF-01  no fire, exit, evacuation or alarm item exists
//   SAF-02  RM-03 grades lights and technology, never access control
//   SAF-03  HK-05 grades staff appearance, PRE-02/05 grade marketing tone
//   REC-11  PRE-03 grades the booking process, never its delivery
//   SP-13   SP-02 grades locker room cleanliness, never privacy

// A fifteenth section for the three property-wide items. They are observed
// continuously across the stay rather than at one point in the journey, so
// placing them inside a journey section would mis-scope them.
export const NEW_SECTIONS = [
  {
    id: 'safety',
    label: 'Safety, Security & Conduct',
    icon: '⊗',
    facility: null,
    // Inserted after this existing section so the order stays journey-like.
    insertAfter: 'facilities',
    items: [
      { id: 'SAF-01', label: 'Emergency exits, fire safety equipment and evacuation information present, unobstructed and current', minStars: 4 },
      { id: 'SAF-02', label: 'Guest room locks, secondary security and in-room safe function correctly', minStars: 4 },
      { id: 'SAF-03', label: 'Guests treated with respect and professionalism, without discrimination', minStars: 4 },
    ],
  },
];

// Items appended to sections that already exist.
export const NEW_ITEMS = [
  {
    sectionId: 'reception',
    item: { id: 'REC-11', label: 'Reservation delivered exactly as confirmed: room type, rate, dates and stated requirements', minStars: 4 },
  },
  {
    sectionId: 'spa',
    // Gated by hasSpa through its section, so it is never scored against a
    // property without a spa.
    item: { id: 'SP-13', label: 'Guest privacy and dignity protected during treatments and in changing areas', minStars: 4 },
  },
];
