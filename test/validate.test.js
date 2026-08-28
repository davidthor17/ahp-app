import test from 'node:test';
import assert from 'node:assert/strict';

import { validateFramework, assertFrameworkValid } from '../src/framework/validate.js';
import { CATALOG_SECTIONS, catalogItems } from '../src/framework/catalog.js';
import { ITEM_META } from '../src/framework/items.js';
import { FRAMEWORK } from '../src/framework/version.js';
import { SEVERITY } from '../src/framework/weights.js';

test('framework validates against the authoritative catalogue', () => {
  const result = validateFramework();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('catalogue totals match the framework contract exactly', () => {
  const { stats } = assertFrameworkValid();
  assert.equal(stats.items, 147);
  assert.equal(stats.sections, 15);
  assert.equal(stats.theoreticalWeight, 298);
  assert.equal(stats.byClass.foundation.items, 34);
  assert.equal(stats.byClass.standard.items, 83);
  assert.equal(stats.byClass.distinction.items, 30);
  assert.equal(stats.byClass.foundation.weight, 102);
  assert.equal(stats.byClass.standard.weight, 166);
  assert.equal(stats.byClass.distinction.weight, 30);
  assert.equal(FRAMEWORK.expectedTheoreticalWeight, 298);
});

test('metadata and catalogue are a bijection', () => {
  const ids = catalogItems().map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate item ids');
  assert.deepEqual(
    ids.slice().sort(),
    Object.keys(ITEM_META).slice().sort(),
    'every item has metadata and every metadata entry has an item',
  );
});

test('zero_tolerance is never a default severity', () => {
  for (const [id, meta] of Object.entries(ITEM_META)) {
    assert.notEqual(meta.defaultSeverity, SEVERITY.ZERO_TOLERANCE, `${id} must not default to Zero Tolerance`);
  }
});

test('the five new items exist exactly once, in the right sections', () => {
  const index = new Map(catalogItems().map((i) => [i.id, i]));
  const expected = {
    'SAF-01': 'safety',
    'SAF-02': 'safety',
    'SAF-03': 'safety',
    'REC-11': 'reception',
    'SP-13': 'spa',
  };
  for (const [id, sectionId] of Object.entries(expected)) {
    const item = index.get(id);
    assert.ok(item, `${id} is present in the catalogue`);
    assert.equal(item.sectionId, sectionId);
    assert.equal(item.meta.weightClass, 'foundation');
    assert.equal(item.minStars, 4);
  }
  // SP-13 must inherit the spa facility gate so it is never scored against a
  // property with no spa.
  assert.equal(index.get('SP-13').facility, 'hasSpa');
});

// ── Drift detection: the validator must fail loudly, not quietly pass ───────

const clone = (sections) => sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }));

test('fails when an audit item has no framework metadata', () => {
  const sections = clone(CATALOG_SECTIONS);
  sections[0].items.push({ id: 'NEW-99', label: 'Added without metadata', minStars: 4 });
  const r = validateFramework({ sections });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('NEW-99') && e.includes('no framework metadata')));
});

test('fails on orphan metadata with no matching audit item', () => {
  const meta = { ...ITEM_META, 'GHOST-01': { weightClass: 'standard', dimension: 'service', defaultSeverity: 'minor', zeroToleranceEligible: false } };
  const r = validateFramework({ meta });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('GHOST-01') && e.includes('no such item')));
});

test('fails when an item is mapped twice', () => {
  const sections = clone(CATALOG_SECTIONS);
  sections[1].items.push({ ...sections[0].items[0] });
  const r = validateFramework({ sections });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('appears twice')));
});

test('fails on a missing or invalid weight class, severity or dimension', () => {
  const base = ITEM_META['PRE-01'];
  for (const [field, value, needle] of [
    ['weightClass', undefined, 'no weight class'],
    ['weightClass', 'huge', 'invalid weight class'],
    ['defaultSeverity', undefined, 'no default severity'],
    ['defaultSeverity', 'catastrophic', 'invalid default severity'],
    ['defaultSeverity', SEVERITY.ZERO_TOLERANCE, 'invalid default severity'],
    ['dimension', undefined, 'no dimension'],
    ['dimension', 'vibes', 'invalid dimension'],
    ['zeroToleranceEligible', 'yes', 'non-boolean'],
  ]) {
    const meta = { ...ITEM_META, 'PRE-01': { ...base, [field]: value } };
    const r = validateFramework({ meta });
    assert.equal(r.ok, false, `${field}=${value} should fail validation`);
    assert.ok(r.errors.some((e) => e.includes(needle)), `expected an error containing "${needle}"`);
  }
});

test('fails when the item count or theoretical weight drifts', () => {
  const sections = clone(CATALOG_SECTIONS);
  sections[0].items.pop();
  const r = validateFramework({ sections });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('item count is 146')));
  assert.ok(r.errors.some((e) => e.includes('theoretical weight is')));
});

test('assertFrameworkValid throws with every error listed', () => {
  const sections = clone(CATALOG_SECTIONS);
  sections[0].items.push({ id: 'NEW-99', label: 'x', minStars: 4 });
  assert.throws(() => assertFrameworkValid({ sections }), /validation failed with \d+ error/);
});
