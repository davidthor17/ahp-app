// Phase 5.5 — one real publish, end to end, minus the network call.
//
// The property, the graded items and the frozen snapshot below were captured
// from the running console during browser verification: a 5★ property with one
// question answered no, one answered yes, and three left unanswered. Feeding
// exactly that state through the writer proves the payload the console would
// send, without sending it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPublishedResult, validatePublishedResult } from '../src/framework/publishedResult.js';
import { resolveScoringProfile, SNAPSHOT_STATUS } from '../src/framework/snapshot.js';
import { dependencyFlagsToRow } from '../src/framework/propertyFlags.js';

// Captured verbatim from localStorage after grading three items in the console.
const PROP = {
  name: 'Flag Test Hotel', city: 'Reykjavik', country: 'Iceland', category: '5★',
  chain: false, chainName: '', roomCount: '120', roomTypes: ['Standard'],
  shiftCount: '2', rotationPattern: '2-2-3', shiftTimes: {},
  hasRestaurant: true, hasPool: true, hasSpa: true,
  hasSauna: null, hasChangingRooms: null, hasMinibar: true, hasLunchService: null, hasGym: false,
  hasWineList: true, authenticCuisine: true, menuComplexity: 'Moderate', menuVariety: 'Balanced',
  fbCapacity: '90', poolCapacity: '20', poolCount: '1',
};

const AUDIT = {
  'RM-01': { day: { status: 'met', time: '13:26', naReason: null } },
  'RM-02': { day: { status: 'missed', time: '13:26', naReason: null } },
  'RM-04': { day: { status: 'met', time: '13:26', naReason: null } },
};

const SNAPSHOT = {
  propertyCategory: '5★',
  facilityProfile: {
    hasRestaurant: true, hasPool: true, hasSpa: true,
    hasSauna: true, hasChangingRooms: true, hasMinibar: true, hasLunchService: true, hasGym: false,
  },
  auditType: 'full', scopeSections: null,
  frameworkVersion: '1.3.0', checklistVersion: '1.2.0',
  lockedAt: '2026-08-30T13:26:18.208Z',
};

const publish = (over = {}) => buildPublishedResult({
  prop: PROP,
  graded: AUDIT,
  auditType: 'full',
  criticalFailures: [{ itemId: 'RM-02', label: 'No hair, stains, or odors', note: 'Room 402.' }],
  scoringBasis: resolveScoringProfile(SNAPSHOT, PROP, SNAPSHOT_STATUS.FROZEN),
  auditedOn: '2026-08-30',
  publishedAt: '2026-08-30T13:30:00.000Z',
  summary: 'Three items assessed during verification.',
  ...over,
});

test('the console would publish a payload that validates', () => {
  assert.deepEqual(validatePublishedResult(publish()), []);
});

test('the payload records what was actually found', () => {
  const p = publish();
  assert.equal(p.formatVersion, 1);
  assert.equal(p.auditType, 'full');
  assert.equal(p.property.name, 'Flag Test Hotel');
  assert.equal(p.property.category, '5★');
  assert.deepEqual(p.score, { percent: 67, itemsMet: 2, itemsGraded: 3 });
  assert.equal(p.standardMet, false, 'a critical failure blocks it whatever the score');
  assert.deepEqual(p.sections, [
    { id: 'room', label: 'Room Quality', total: 3, met: 2, partial: 0, missed: 1, na: 0 },
  ]);
  assert.equal(p.criticalFailures.length, 1);
  assert.equal(p.criticalFailures[0].label, 'No hair, stains, or odors');
});

test('the frozen basis reaches the payload with its real lock date', () => {
  const p = publish();
  assert.deepEqual(p.basis, { state: 'frozen', recordedOn: '2026-08-30T13:26:18.208Z' });
  assert.equal(p.publishedAt, '2026-08-30T13:30:00.000Z');
  assert.notEqual(p.publishedAt, p.basis.recordedOn, 'when it was fixed is not when it was locked');
});

test('one publish stamps one timestamp, not one per field', () => {
  // publishedAt is passed in rather than read from a clock inside the builder,
  // so a slow publish cannot end up with two different times in one payload.
  const a = publish();
  const b = publish();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('the payload carries no internal state, including the versions on the snapshot', () => {
  const flat = JSON.stringify(publish());
  assert.equal(flat.includes('1.3.0'), false, 'the framework version stays internal');
  assert.equal(flat.includes('1.2.0'), false, 'so does the checklist version');
  assert.equal(flat.includes('facilityProfile'), false);
  assert.equal(flat.includes('hasGym'), false);
});

test('this property writes back only the two questions somebody answered', () => {
  assert.deepEqual(dependencyFlagsToRow(PROP), { has_minibar: true, has_gym: false });
});

test('a publish with an unusable basis is still publishable and says so', () => {
  const p = publish({
    scoringBasis: resolveScoringProfile({ propertyCategory: '5★' }, PROP, SNAPSHOT_STATUS.UNUSABLE),
  });
  assert.deepEqual(p.basis, { state: 'incomplete', recordedOn: null });
  assert.deepEqual(validatePublishedResult(p), [], 'the audit is not held hostage by its basis');
});
