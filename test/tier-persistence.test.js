// Phase 7.3C — an unpublished audit's tier has to live somewhere.
//
// Found in production. Audit C was set to Spot on its finish screen and the
// cache confirmed auditTier "spot". Audit D was then started, and C's Spot was
// gone: its row still said "full", its row had not been touched since the
// basis write, and returning to C showed Full.
//
// Three things combined. The tier lived in React state and in one `auditTier`
// slot in the device cache; that slot belongs to whichever audit is open, and
// starting another audit overwrites it; and the row cannot stand in for it,
// because audits.tier is written only at publish, so a draft's row says
// nothing. The tier therefore had no audit-scoped durable home at all.
//
// Phase 7.3 had stopped the tier bleeding from one audit into the next, which
// was the right half. This is the other half: somewhere for it to live. A map
// keyed by audit id, in the same cache, written read-modify-write the way
// pendingQueue and pendingCaptions already are.
//
// The tier decides whether the Specula Mark is issued, so publishing a Spot
// Audit as a Full one is not a cosmetic error.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readTierMap, rememberTier, rememberedTier, tierForOpenAudit, tierForAudit,
  auditScopedReset, mergeDeviceState, AUDIT_TIERS, DEFAULT_TIER,
} from '../src/framework/auditSession.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');

const C = 'ceddb6bb-22a9-4ef6-8417-604840b6a995';
const D = '8781e1cc-831e-4d3e-b429-94ddc423747b';

/** The device cache, as persist() and persistTier leave it. */
const cache = (over = {}) => ({ ids: { auditId: C }, auditTier: 'full', prop: { name: 'C' }, ...over });

// ── the reported sequence ───────────────────────────────────────────────────

test('C keeps Spot across opening D and coming back', () => {
  // C is set to Spot on its finish screen.
  let blob = cache();
  blob.tiersByAudit = rememberTier(blob.tiersByAudit, C, 'spot');
  blob.auditTier = 'spot';

  // D is started. startNewAudit resets the open tier to Full and persist()
  // overwrites the single slot: this is the step that used to lose it.
  blob = mergeDeviceState(blob, { ids: { auditId: D }, auditTier: 'full', prop: { name: 'D' } });
  assert.equal(blob.auditTier, 'full', 'the single slot now belongs to D');
  assert.equal(rememberedTier(blob.tiersByAudit, C), 'spot', 'but C is still on record');

  // Back to C: row has no tier (draft), so the map is what answers.
  const onReturn = tierForOpenAudit({ rowTier: null, remembered: rememberedTier(blob.tiersByAudit, C) });
  assert.equal(onReturn, 'spot');
  assert.equal(auditScopedReset({ tier: onReturn }).auditTier, 'spot', 'and the reset carries it through');
});

test('the defect, reproduced: without the map the row and the slot both say Full', () => {
  let blob = cache({ auditTier: 'spot' });                       // C on Spot, no map
  blob = mergeDeviceState(blob, { ids: { auditId: D }, auditTier: 'full' });
  assert.equal(tierForAudit(null, DEFAULT_TIER), 'full', 'the row says nothing for a draft');
  assert.equal(rememberedTier(blob.tiersByAudit, C), null, 'and nothing was remembered');
  assert.equal(auditScopedReset({ tier: null }).auditTier, 'full', 'so C comes back as Full');
});

test('D does not inherit C\'s Spot', () => {
  const map = rememberTier(undefined, C, 'spot');
  assert.equal(rememberedTier(map, D), null, 'D has nothing of its own, and nothing of C\'s');
  assert.equal(tierForOpenAudit({ rowTier: null, remembered: rememberedTier(map, D) }), 'full');
  // And a brand-new audit has no id to look up at all.
  assert.equal(tierForOpenAudit({ rowTier: null, remembered: rememberedTier(map, null) }), 'full');
});

test('C\'s Spot survives a reload, through JSON and back', () => {
  const blob = cache({ tiersByAudit: rememberTier(undefined, C, 'spot') });
  const reloaded = JSON.parse(JSON.stringify(blob));
  assert.equal(rememberedTier(reloaded.tiersByAudit, C), 'spot');
  assert.equal(
    tierForOpenAudit({ remembered: rememberedTier(reloaded.tiersByAudit, reloaded.ids.auditId) }),
    'spot',
  );
});

test('two audits keep their own tiers at the same time', () => {
  let map = rememberTier(undefined, C, 'spot');
  map = rememberTier(map, D, 'desk');
  assert.equal(rememberedTier(map, C), 'spot');
  assert.equal(rememberedTier(map, D), 'desk');
  assert.deepEqual(Object.keys(map).sort(), [D, C].sort());
});

// ── precedence ──────────────────────────────────────────────────────────────

test('a published row\'s tier outranks anything this device remembers', () => {
  const map = rememberTier(undefined, C, 'spot');
  assert.equal(tierForOpenAudit({ rowTier: 'full', remembered: rememberedTier(map, C) }), 'full',
    'what was issued is a fact; the device does not get to argue with it');
  assert.equal(tierForOpenAudit({ rowTier: 'desk', remembered: 'spot' }), 'desk');
});

test('nothing recorded anywhere is Full, and rubbish is never trusted', () => {
  assert.equal(tierForOpenAudit({}), DEFAULT_TIER);
  assert.equal(tierForOpenAudit({ rowTier: 'nonsense', remembered: 'rubbish' }), DEFAULT_TIER);
  assert.equal(tierForOpenAudit({ rowTier: null, remembered: 'spot' }), 'spot');
  assert.deepEqual([...AUDIT_TIERS], ['desk', 'spot', 'full']);
});

test('the map refuses anything that is not an audit id and a real tier', () => {
  assert.deepEqual(readTierMap(null), {});
  assert.deepEqual(readTierMap('nonsense'), {});
  assert.deepEqual(readTierMap([1, 2]), {});
  assert.deepEqual(readTierMap({ [C]: 'gold-plated' }), {}, 'an unknown tier is dropped');
  assert.deepEqual(readTierMap({ '': 'spot' }), {}, 'and so is a missing id');
  assert.deepEqual(rememberTier(undefined, C, 'nonsense'), {}, 'and it cannot be written in the first place');
  assert.deepEqual(rememberTier(undefined, null, 'spot'), {}, 'an audit with no id yet records nothing');
});

// ── the cache must not lose it ──────────────────────────────────────────────

test('a whole-blob persist() preserves the tier map', () => {
  const blob = cache({ tiersByAudit: rememberTier(undefined, C, 'spot') });
  const afterPersist = mergeDeviceState(blob, {
    prop: { name: 'C' }, audit: {}, ids: { auditId: C }, snapshot: null,
    trailQueue: [], auditTier: 'spot', pendingQueue: { v: 1, entries: [] },
  });
  assert.equal(rememberedTier(afterPersist.tiersByAudit, C), 'spot',
    'the same rule that protects pendingCaptions protects this');
});

// ── the wiring ──────────────────────────────────────────────────────────────

test('the tier is written read-modify-write, against the audit id', () => {
  const fn = APP.slice(APP.indexOf('const persistTier'), APP.indexOf('const persistTier') + 700);
  assert.match(fn, /const raw = localStorage\.getItem\(STORAGE_KEY\);/, 'read');
  assert.match(fn, /data\.tiersByAudit = rememberTier\(data\.tiersByAudit, auditId, tier\);/, 'modify');
  assert.match(fn, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(data\)\);/, 'write');
  // Written at the click, not from an effect watching auditTier: an effect
  // cannot tell a choice from an audit being opened and reset, which is how
  // the first attempt filed one audit's default under another's id.
  assert.match(APP, /persistTier\(ids\.auditId, tier\);/, 'called when the auditor chooses a tier');
});

test('resume and reload both consult the map', () => {
  assert.match(APP, /rememberedTier\(cached \? JSON\.parse\(cached\)\.tiersByAudit : null, row\.id\)/, 'resume');
  assert.match(APP, /tierForOpenAudit\(\{ rowTier: auditRow && auditRow\.tier, remembered: rememberedForThisAudit \}\)/, 'resume precedence');
  assert.match(APP, /rememberedTier\(data\.tiersByAudit, data\.ids && data\.ids\.auditId\) \|\| data\.auditTier/, 'reload prefers the map over the slot');
  assert.equal(/\['desk', 'spot', 'full'\]\.includes\(data\.auditTier\)/.test(APP), false,
    'the inline tier list that only knew about the single slot is gone');
});

test('nothing writes a tier to the row before publish', () => {
  // The only place audits.tier is written stays the publish update.
  const tierWrites = APP.match(/\btier,?\n?\s*$|tier:\s*[a-zA-Z]/gm) || [];
  assert.match(APP, /status: 'published',[\s\S]{0,200}tier,/, 'publish still writes the tier');
  assert.equal(/update\(\{[^}]*tier[^}]*\}\)[\s\S]{0,80}snapshot_locked_at/.test(APP), false,
    'and the basis write does not carry one');
  assert.ok(tierWrites.length >= 1);
});

test('the audit-scoped reset still clears everything else it always did', () => {
  const fresh = auditScopedReset({ tier: 'spot' });
  assert.equal(fresh.auditTier, 'spot', 'the tier is the one thing now carried in deliberately');
  assert.equal(fresh.summaryDraft, '');
  assert.equal(fresh.legacyAck, false);
  assert.deepEqual(fresh.photos, {});
  assert.deepEqual(fresh.pendingCaptions, []);
  assert.equal(fresh.publication, null);
  assert.equal(fresh.publicToken, null);
  assert.equal(fresh.publishState, 'idle');
});
