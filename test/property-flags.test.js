// Phase 5.5 — a property flag has three states, and the round trip must keep
// all three.
//
// rowToProp used to collapse null to true. The app's property state was a plain
// boolean with nowhere to hold "nobody has been asked", so the first save after
// the write path was enabled would have written true into all five columns for
// every property: seven rows of honest unknowns turned into fabricated fact,
// permanently, with nothing to recover from.
//
// The asymmetry is the whole reason for the care. A wrong true only adds
// requirements, and an auditor notices. A wrong false silently removes them, and
// nobody notices.

import test from 'node:test';
import assert from 'node:assert/strict';

import { triState, dependencyFlagsToRow, dependencyFlagsFromRow } from '../src/framework/propertyFlags.js';
import { applicableItems, isApplicable, catalogIndex } from '../src/framework/catalog.js';
import { buildSnapshot, resolveScoringProfile } from '../src/framework/snapshot.js';
import { AUDIT_TYPE } from '../src/framework/weights.js';

const FLAGS = ['hasSauna', 'hasChangingRooms', 'hasMinibar', 'hasLunchService', 'hasGym'];
const COLUMNS = {
  hasSauna: 'has_sauna',
  hasChangingRooms: 'has_changing_rooms',
  hasMinibar: 'has_minibar',
  hasLunchService: 'has_lunch_service',
  hasGym: 'has_gym',
};
const GATED = {
  hasSauna: ['SP-04'],
  hasChangingRooms: ['SP-02', 'SP-03'],
  hasMinibar: ['RM-10'],
  hasLunchService: ['LUN-02'],
  hasGym: ['FAC-04', 'FAC-05', 'FAC-06'],
};

const BASE = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
const FULL = { auditType: AUDIT_TYPE.FULL };
const ids = (profile) => new Set(applicableItems(profile).map((i) => i.id));

// ── 13 to 16: the round trip ────────────────────────────────────────────────

test('13. null round trips as null, never as true', () => {
  for (const flag of FLAGS) {
    assert.equal(triState(null), null, `${flag}: read stays null`);
    // And a null value is not written at all, so the column keeps its null.
    assert.deepEqual(dependencyFlagsToRow({ [flag]: null }), {}, `${flag}: not written`);
  }
});

test('14. an absent column is unknown, and stays unknown', () => {
  assert.equal(triState(undefined), null);
  assert.deepEqual(dependencyFlagsToRow({}), {}, 'nothing to write');
  const row = {}; // a properties row from before the migration
  const prop = { ...BASE };
  for (const flag of FLAGS) prop[flag] = triState(row[COLUMNS[flag]]);
  for (const flag of FLAGS) assert.equal(prop[flag], null, `${flag} is unknown`);
});

test('15. true round trips as true', () => {
  assert.equal(triState(true), true);
  assert.deepEqual(dependencyFlagsToRow({ hasGym: true }), { has_gym: true });
  for (const flag of FLAGS) {
    assert.deepEqual(dependencyFlagsToRow({ [flag]: true }), { [COLUMNS[flag]]: true });
  }
});

test('16. false round trips as false, because it is a recorded decision', () => {
  assert.equal(triState(false), false);
  for (const flag of FLAGS) {
    assert.deepEqual(dependencyFlagsToRow({ [flag]: false }), { [COLUMNS[flag]]: false });
  }
});

test('the full round trip preserves every state through the database shape', () => {
  for (const [column, expected] of [[null, null], [undefined, null], [true, true], [false, false]]) {
    const row = { has_gym: column };
    const prop = { hasGym: triState(row.has_gym) };
    assert.equal(prop.hasGym, expected, `${String(column)} reads as ${String(expected)}`);
    const written = dependencyFlagsToRow(prop);
    if (expected === null) {
      assert.deepEqual(written, {}, 'unknown writes nothing back');
    } else {
      assert.deepEqual(written, { has_gym: expected }, 'a decision writes itself back');
    }
  }
});

// ── 17: an unrelated save must not fabricate anything ───────────────────────

test('17. saving a property to change its name preserves every unknown flag', () => {
  // Exactly the scenario that would have destroyed the unknowns: somebody
  // corrects a typo in the hotel name and saves.
  const prop = { ...BASE, name: 'Hotel Borealis' };
  for (const flag of FLAGS) prop[flag] = null;

  const written = dependencyFlagsToRow({ ...prop, name: 'Hotel Boreal' });
  assert.deepEqual(written, {}, 'not one flag column is written');
  for (const flag of FLAGS) {
    assert.equal(Object.prototype.hasOwnProperty.call(written, COLUMNS[flag]), false,
      `${COLUMNS[flag]} must be absent from the update, not present as null`);
  }
});

test('17b. answering one question does not answer the other four', () => {
  const prop = { ...BASE };
  for (const flag of FLAGS) prop[flag] = null;
  prop.hasGym = false; // somebody looked, and there is no gym

  const written = dependencyFlagsToRow(prop);
  assert.deepEqual(written, { has_gym: false });
  assert.equal(Object.keys(written).length, 1, 'the other four stay unanswered');
});

test('17c. a value that is not a boolean is never written', () => {
  // Guards against a stray string or number reaching the column as a truthy
  // value and becoming a fact nobody stated.
  for (const junk of ['yes', 'false', 0, 1, '', NaN, {}, []]) {
    assert.deepEqual(dependencyFlagsToRow({ hasGym: junk }), {}, `${JSON.stringify(junk)} is not an answer`);
  }
});

// ── 18: scoring semantics do not move ───────────────────────────────────────

test('18. unknown behaves exactly as present, for every flag', () => {
  for (const flag of FLAGS) {
    const unknown = { ...BASE, [flag]: null };
    const present = { ...BASE, [flag]: true };
    assert.deepEqual([...ids(unknown)], [...ids(present)], `${flag}: unknown must keep every item`);
    for (const id of GATED[flag]) {
      assert.equal(ids(unknown).has(id), true, `${flag}: ${id} survives an unanswered question`);
    }
  }
});

test('18b. only an explicit false removes an item, which is unchanged', () => {
  const index = catalogIndex();
  for (const flag of FLAGS) {
    for (const id of GATED[flag]) {
      const item = index.get(id);
      assert.equal(isApplicable(item, { ...BASE, [flag]: null }), true, `${id}: null keeps it`);
      assert.equal(isApplicable(item, { ...BASE, [flag]: undefined }), true, `${id}: undefined keeps it`);
      assert.equal(isApplicable(item, { ...BASE, [flag]: true }), true, `${id}: true keeps it`);
      assert.equal(isApplicable(item, { ...BASE, [flag]: false }), false, `${id}: only false removes it`);
    }
  }
});

test('18c. the snapshot reads a three-state flag the same way isApplicable does', () => {
  for (const flag of FLAGS) {
    for (const state of [null, undefined, true, false]) {
      const prop = { ...BASE, [flag]: state };
      const frozen = resolveScoringProfile(buildSnapshot(prop, FULL), prop).profile;
      assert.deepEqual(
        [...ids(frozen)], [...ids(prop)],
        `${flag}=${String(state)}: the snapshot must select what the live property selects`,
      );
    }
  }
});

test('18d. an all-unknown property keeps its whole audit, live and frozen', () => {
  const unknown = { ...BASE };
  for (const flag of FLAGS) unknown[flag] = null;

  const live = applicableItems(unknown);
  const frozen = applicableItems(resolveScoringProfile(buildSnapshot(unknown, FULL), unknown).profile);
  assert.equal(live.length, 133, '5★ with every facility carries 133 of the 147 items');
  assert.equal(frozen.length, live.length);
  assert.equal(frozen.filter((i) => i.meta.weightClass === 'foundation').length, 34);
});

test('a property with every question answered no loses exactly eight items', () => {
  const none = { ...BASE };
  for (const flag of FLAGS) none[flag] = false;
  assert.equal(ids(BASE).size - ids(none).size, 8, 'the eight gated items');
  for (const flag of FLAGS) for (const id of GATED[flag]) {
    assert.equal(ids(none).has(id), false, `${id} is gone`);
  }
});

// ── the live-property fallback must read three states too ───────────────────
//
// Found in browser verification, not by a unit test: a brand new audit with an
// all-unknown property showed 125 items instead of 133. Before a snapshot
// exists the capture screen resolves through the live-property fallback, and
// that branch collapsed null to false with Boolean(). Harmless while the
// console could not hold a null. A real fault the moment it could.

test('an unanswered flag survives the live-property fallback, before any snapshot', () => {
  const unknown = { ...BASE };
  for (const flag of FLAGS) unknown[flag] = null;

  const basis = resolveScoringProfile(null, unknown);
  assert.equal(basis.source, 'live-property-fallback');
  for (const flag of FLAGS) {
    assert.equal(basis.profile[flag], true, `${flag}: unknown must resolve as present`);
  }
  assert.equal(applicableItems(basis.profile).length, 133, 'the whole 5★ audit, not a shortened one');
});

test('the fallback reads all four states the same way isApplicable does', () => {
  for (const flag of FLAGS) {
    for (const [state, expected] of [[null, true], [undefined, true], [true, true], [false, false]]) {
      const prop = { ...BASE, [flag]: state };
      const basis = resolveScoringProfile(null, prop);
      assert.equal(basis.profile[flag], expected, `${flag}=${String(state)}`);
      assert.deepEqual(
        [...ids(basis.profile)], [...ids(prop)],
        `${flag}=${String(state)}: the fallback must select what the property selects`,
      );
    }
  }
});

test('a recorded absence still removes its items through the fallback', () => {
  const none = { ...BASE };
  for (const flag of FLAGS) none[flag] = false;
  const basis = resolveScoringProfile(null, none);
  assert.equal(applicableItems(basis.profile).length, 125, 'eight gated items leave');
});
