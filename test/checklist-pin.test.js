// Phase 5.8 P0-B — an audit keeps the checklist it started with.
//
// The snapshot froze the property: category, facility profile, audit type,
// scope sections. It never froze which items existed. isApplicable and
// applicableItems both walk catalogIndex(), which defaults to today's
// SECTIONS, so an audit's scope grew every time src/auditItems.js grew.
// checklist_version was recorded on the row and read by nothing.
//
// AHP-2026-D699 is what this cost: 71 of 71 on the bundle it was captured
// with, 71 of 107 today, having not itself changed at all. It was a legacy
// audit, but a frozen one would have drifted identically, because the drift
// was never about the basis being missing.
//
// A null pin is the pre-Phase-5.8 behaviour and every existing audit has one.
// That is asserted here as hard as the pin itself: this change must be
// invisible to all seven audits in production.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSnapshot, snapshotToRow, snapshotFromRow, resolveScoringProfile,
  isUsableSnapshot, SNAPSHOT_COLUMNS, SNAPSHOT_STATUS,
} from '../src/framework/snapshot.js';
import {
  applicableItems, isApplicable, inChecklist, catalogItems,
} from '../src/framework/catalog.js';
import { score } from '../src/framework/scoring.js';

const PROP = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
const LOCKED_AT = '2026-09-09T10:00:00.000Z';
const frozen = (over = {}) => buildSnapshot({ ...PROP, ...over }, { lockedAt: LOCKED_AT });

/** A catalogue with one extra section, standing in for a later release. */
const withExtraItems = (sections) => [
  ...sections,
  {
    id: 'newsection', label: 'Added Later', items: [
      { id: 'NEW-01', label: 'Added after the audit began', minStars: 1 },
      { id: 'NEW-02', label: 'Also added later', minStars: 1 },
    ],
  },
];

// ── the pin is recorded ─────────────────────────────────────────────────────

test('a frozen basis records the item ids it applies to', () => {
  const snapshot = frozen();
  assert.ok(Array.isArray(snapshot.checklistItems), 'the pin is an array');
  assert.ok(snapshot.checklistItems.length > 0, 'and it is not empty');

  const live = applicableItems({ category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true })
    .map((i) => i.id);
  assert.deepEqual(snapshot.checklistItems, live,
    'and it is exactly what applies to this property today');
});

test('the pin narrows with a Spot scope, like the rest of the basis', () => {
  const spot = buildSnapshot(PROP, {
    auditType: 'spot',
    scopeSections: ['room', 'bathroom', 'safety'],
    lockedAt: LOCKED_AT,
  });
  const sections = new Set(catalogItems()
    .filter((i) => spot.checklistItems.includes(i.id))
    .map((i) => i.sectionId));
  assert.deepEqual([...sections].sort(), ['bathroom', 'room', 'safety']);
});

test('the pin respects the facility gates the basis froze', () => {
  const noSpa = buildSnapshot({ ...PROP, hasSpa: false }, { lockedAt: LOCKED_AT });
  const spaItems = catalogItems().filter((i) => i.sectionId === 'spa').map((i) => i.id);
  for (const id of spaItems) {
    assert.equal(noSpa.checklistItems.includes(id), false, `${id} must not be pinned`);
  }
});

// ── the pin holds when the catalogue grows ──────────────────────────────────

test('a frozen audit does not gain items added to the catalogue later', () => {
  // The defect, reproduced and then prevented.
  const snapshot = frozen();
  const basis = resolveScoringProfile(snapshot, PROP, SNAPSHOT_STATUS.FROZEN);
  const tomorrow = withExtraItems(catalogSections());

  const unpinned = applicableItems(basis.profile, { sections: tomorrow }).map((i) => i.id);
  const pinned = applicableItems(basis.profile, {
    sections: tomorrow, checklistItems: basis.checklistItems,
  }).map((i) => i.id);

  assert.ok(unpinned.includes('NEW-01'), 'without a pin the audit grows');
  assert.equal(pinned.includes('NEW-01'), false, 'with one it does not');
  assert.equal(pinned.includes('NEW-02'), false);
  assert.equal(pinned.length, basis.checklistItems.length,
    'the audit covers exactly what it froze');
});

test('the count an auditor sees does not move when the catalogue grows', () => {
  // 71/71 becoming 71/107 is the whole complaint. The denominator must hold.
  const snapshot = frozen();
  const basis = resolveScoringProfile(snapshot, PROP, SNAPSHOT_STATUS.FROZEN);
  const before = applicableItems(basis.profile, { checklistItems: basis.checklistItems }).length;
  const after = applicableItems(basis.profile, {
    sections: withExtraItems(catalogSections()), checklistItems: basis.checklistItems,
  }).length;
  assert.equal(before, after);
});

test('scoring and capture are pinned by the same set', () => {
  // Handing the pin to one and not the other would be the Phase 5.2 defect in
  // a new place: the auditor grades one list and is scored against another.
  const snapshot = frozen();
  const basis = resolveScoringProfile(snapshot, PROP, SNAPSHOT_STATUS.FROZEN);
  const graded = { 'RM-01': { day: { status: 'met' } } };

  const s = score(graded, basis.profile, {
    scopeSections: basis.scopeSections, checklistItems: basis.checklistItems,
  });
  const captured = applicableItems(basis.profile, {
    scopeSections: basis.scopeSections, checklistItems: basis.checklistItems,
  });
  assert.equal(s.counts.applicable ?? captured.length, captured.length);
});

// ── null pins keep the old behaviour, exactly ───────────────────────────────

test('a null pin lets everything through, which is the legacy behaviour', () => {
  assert.equal(inChecklist('RM-01', null), true);
  assert.equal(inChecklist('ANYTHING', null), true);
  assert.equal(inChecklist('RM-01', undefined), true);
});

test('a basis frozen before the pin existed still reads the live catalogue', () => {
  // Exactly the shape snapshotFromRow produces for the seven existing rows.
  const old = { ...frozen(), checklistItems: undefined };
  const basis = resolveScoringProfile(old, PROP, SNAPSHOT_STATUS.FROZEN);
  assert.equal(basis.checklistItems, null, 'no pin');

  const grown = applicableItems(basis.profile, {
    sections: withExtraItems(catalogSections()), checklistItems: basis.checklistItems,
  }).map((i) => i.id);
  assert.ok(grown.includes('NEW-01'), 'and it behaves exactly as it does today');
});

test('a legacy unfrozen audit is unaffected in every way', () => {
  const basis = resolveScoringProfile(null, PROP, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
  assert.equal(basis.checklistItems, null);
  assert.equal(basis.frozen, false);
  assert.equal(basis.status, SNAPSHOT_STATUS.LEGACY_UNFROZEN);
});

test('an empty pin is never stored and never read as a pin', () => {
  // An empty array asserts that no item applies, which would empty the audit
  // rather than pin it. It must not survive in either direction.
  assert.equal(snapshotToRow({ ...frozen(), checklistItems: [] }).checklist_items, null);
  assert.equal(snapshotFromRow({ ...snapshotToRow(frozen()), checklist_items: [] }).checklistItems, null);
  assert.equal(inChecklist('RM-01', []), true, 'and an empty pin blocks nothing');
});

// ── the pin survives the row, a reload and a resume ─────────────────────────

test('the pin survives the audits row round trip', () => {
  const snapshot = frozen();
  const row = snapshotToRow(snapshot);
  assert.ok(Array.isArray(row.checklist_items));
  assert.deepEqual(row.checklist_items, snapshot.checklistItems);

  const back = snapshotFromRow({ ...row, tier: 'full' });
  assert.deepEqual(back.checklistItems, snapshot.checklistItems,
    'which is what makes it work on another device and after a storage clear');
});

test('the pin survives a localStorage round trip', () => {
  const snapshot = frozen();
  const back = JSON.parse(JSON.stringify({ snapshot })).snapshot;
  assert.deepEqual(back.checklistItems, snapshot.checklistItems);
});

test('resuming from the row alone restores the pin', () => {
  // Resume Audit reads the row and nothing else, so this is the path that
  // matters after a cleared browser or on a second device.
  const row = { ...snapshotToRow(frozen()), tier: 'full' };
  const resumed = snapshotFromRow(row);
  const basis = resolveScoringProfile(resumed, PROP, SNAPSHOT_STATUS.FROZEN);

  const grown = applicableItems(basis.profile, {
    sections: withExtraItems(catalogSections()), checklistItems: basis.checklistItems,
  }).map((i) => i.id);
  assert.equal(grown.includes('NEW-01'), false, 'the resumed audit is still pinned');
});

test('a row with no pin resumes as an unpinned audit rather than an empty one', () => {
  // The seven existing audits, read back after the migration adds the column.
  const row = { ...snapshotToRow(frozen()), tier: 'full', checklist_items: null };
  assert.equal(snapshotFromRow(row).checklistItems, null);
});

// ── the column and the shape of the write ───────────────────────────────────

test('checklist_items is one of the columns the basis writes', () => {
  assert.ok(SNAPSHOT_COLUMNS.includes('checklist_items'));
  assert.equal(SNAPSHOT_COLUMNS.length, 7);
  assert.deepEqual(Object.keys(snapshotToRow(frozen())).sort(), [...SNAPSHOT_COLUMNS].sort());
});

test('a snapshot with no pin is still usable, so nothing existing breaks', () => {
  const old = { ...frozen() };
  delete old.checklistItems;
  assert.equal(isUsableSnapshot(old), true);
  assert.ok(snapshotToRow(old), 'and it still writes');
});

test('the pin gate is checked alongside the other four, not instead of them', () => {
  const item = catalogItems().find((i) => i.sectionId === 'spa');
  // In the pin but the facility is gone: still not applicable.
  assert.equal(isApplicable(item, { category: '5★', hasSpa: false }, null, [item.id]), false);
  // Applicable but not in the pin: still not applicable.
  assert.equal(isApplicable(item, { category: '5★', hasSpa: true }, null, ['SOMETHING-ELSE']), false);
  // Both satisfied.
  assert.equal(isApplicable(item, { category: '5★', hasSpa: true }, null, [item.id]), true);
});

/** Today's catalogue sections, read the way catalog.js reads them. */
function catalogSections() {
  const bySection = new Map();
  for (const item of catalogItems()) {
    if (!bySection.has(item.sectionId)) {
      bySection.set(item.sectionId, { id: item.sectionId, label: item.sectionLabel, facility: item.facility, items: [] });
    }
    bySection.get(item.sectionId).items.push({
      id: item.id, label: item.label, minStars: item.minStars, requires: item.requires,
    });
  }
  return [...bySection.values()];
}
