// Phase 7.3C — an item the property is not graded on must not look gradable.
//
// Found during the queue field test, and it cost a run. On a 4★ property the
// 5★+ items render dimmed at 0.45 opacity, which is the correct visual, and
// their grade buttons were live: not disabled, no aria-disabled, pointer
// events on, cursor default. A click was accepted by the DOM and dropped by a
// guard inside the handler. The first permanent-failure test clicked one,
// produced no write at all, and the empty request log was the only evidence
// that anything had gone wrong.
//
// Worse than the dead taps: "Flag critical" had no guard at all, so flagging
// an out-of-tier item queued a real patch for an item the audit does not
// contain, which is exactly the shape of the UNKNOWN_ITEM refusals this phase
// has been chasing.
//
// So: genuinely disabled controls, and the write paths themselves refuse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogIndex, isApplicable, rankOf } from '../src/framework/catalog.js';
import { STAR_RANK } from '../src/framework/weights.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');

// The property the field test ran against.
const FOUR_STAR = { category: '4★', hasRestaurant: true, hasPool: false, hasSpa: false };
const FIVE_STAR = { category: '5★', hasRestaurant: true, hasPool: false, hasSpa: false };

const INDEX = catalogIndex();

// ── the framework truth the UI gates on ─────────────────────────────────────

test('REC-05 is the out-of-tier item the field test tripped over', () => {
  const item = INDEX.get('REC-05');
  assert.ok(item, 'the item still exists in the catalogue');
  assert.equal(item.minStars, 5, 'and it is still a 5★ item, which is why the card showed 5★+');
  assert.equal(rankOf(FOUR_STAR), 4);
  assert.equal(isApplicable(item, FOUR_STAR), false, 'not gradable at 4★');
  assert.equal(isApplicable(item, FIVE_STAR), true, 'gradable at 5★, so nothing is disabled forever');
});

test('an eligible item at the same 4★ property stays applicable', () => {
  // Requirement 7. The fix must not catch anything that was legitimately
  // gradable, so this is asserted against the same profile, not a friendlier one.
  const eligible = INDEX.get('REC-01');
  assert.ok(eligible);
  assert.ok(eligible.minStars <= 4, 'REC-01 is within a 4★ property\'s tier');
  assert.equal(isApplicable(eligible, FOUR_STAR), true);
});

test('the 4★ checklist still contains plenty that is gradable, and some that is not', () => {
  const items = [...INDEX.values()].filter((i) => !i.facility);
  const out = items.filter((i) => !isApplicable(i, FOUR_STAR));
  const inTier = items.filter((i) => isApplicable(i, FOUR_STAR));
  assert.ok(out.length > 0, 'there are out-of-tier items to disable');
  assert.ok(inTier.length > out.length, 'and far more that must stay interactive');
  for (const i of out) assert.ok(i.minStars > rankOf(FOUR_STAR) || i.requires, 'nothing is out of tier by accident');
  assert.deepEqual(Object.keys(STAR_RANK), ['4★', '5★', 'Ultra']);
});

// ── the controls are genuinely inert ────────────────────────────────────────

/** The one item card, from the map callback to the end of its grade row. */
const CARD = APP.slice(APP.indexOf('const applicable = isItemApplicable(item.id);'), APP.indexOf('{/* Why this item does not apply.'));

test('the grade buttons are disabled, not merely ignored', () => {
  const gradeRow = CARD.slice(CARD.indexOf('{Object.entries(STATUS).map'));
  assert.match(gradeRow, /disabled=\{!applicable\}/, 'native disabled: pointer, keyboard and touch at once');
  assert.match(gradeRow, /aria-disabled=\{!applicable\}/, 'and exposed as disabled to a screen reader');
  // The handler guard stays. Disabled is the fix; this is the line behind it.
  assert.match(gradeRow, /onClick=\{\(\) => applicable && \(key === 'na' \? requestNa\(item\.id\) : setStatus\(item\.id, key\)\)\}/);
});

test('Flag critical is disabled too, because it wrote', () => {
  // Anchored on the handler, not the label: the same label appears on the
  // finish screen, and a negative slice index would quietly read from the
  // wrong end of the file rather than fail.
  const flagIdx = CARD.indexOf('toggleCritical(item.id)');
  assert.ok(flagIdx > 0, 'the critical control is in the card');
  const flagRow = CARD.slice(Math.max(0, flagIdx - 600), flagIdx + 200);
  assert.match(flagRow, /disabled=\{!applicable\}/);
  assert.match(flagRow, /aria-disabled=\{!applicable\}/);
  assert.match(flagRow, /onClick=\{\(\) => applicable && toggleCritical\(item\.id\)\}/,
    'the guard this control never had');
});

test('nothing is disabled unconditionally', () => {
  // Requirement 6. Every disabled flag added here is bound to applicability,
  // so an in-tier control can never be caught by it.
  const added = CARD.match(/disabled=\{[^}]*\}/g) || [];
  assert.ok(added.length >= 2, 'the grade buttons and the critical flag');
  for (const d of added) assert.equal(d, 'disabled={!applicable}', `unexpected disabled binding: ${d}`);
});

test('the existing visual distinction is preserved', () => {
  // Requirement 5. The dimming and the 5★+ chip are how an auditor knows why,
  // and they were never the problem.
  assert.match(CARD, /opacity: applicable \? 1 : 0\.45/);
  assert.match(CARD, /\{item\.minStars === 6 \? 'Ultra only' : '5★\+'\}/);
});

// ── and the write paths refuse anyway ───────────────────────────────────────

test('setStatus refuses an item that is not applicable', () => {
  const fn = APP.slice(APP.indexOf('const setStatus = (itemId, status, naReason = null) => {'), APP.indexOf('const requestNa'));
  assert.match(fn, /if \(!isItemApplicable\(itemId\)\) return;/);
  // The guard is first, before any state is built or any trail is recorded.
  assert.ok(fn.indexOf('isItemApplicable') < fn.indexOf('const prev = audit[itemId]'));
});

test('toggleCritical refuses one too, which is the write that used to get through', () => {
  const fn = APP.slice(APP.indexOf('const toggleCritical = (itemId) => {'), APP.indexOf('// every item ever flagged critical'));
  assert.match(fn, /if \(!isItemApplicable\(itemId\)\) return;/);
  assert.ok(fn.indexOf('isItemApplicable') < fn.indexOf('pushItem('), 'the guard is ahead of the queue write');
});

test('both guards ask the same question the UI asks', () => {
  // One source of truth. If applicability changes, the buttons and the write
  // paths change with it, because all three call isItemApplicable.
  assert.ok((APP.match(/isItemApplicable\(itemId\)/g) || []).length >= 2);
  assert.match(APP, /const applicable = isItemApplicable\(item\.id\);/);
});
