// Phase 7.3C, second attempt — only a choice writes a tier.
//
// The first fix gave the tier a durable per-audit home and then wrote to it
// from an effect watching auditTier. The live round trip failed:
//
//   C set to Spot          tiersByAudit = { C: "spot" }      correct
//   open D                 tiersByAudit = { C: "full" }      wrong
//   return to C            resolves Full                     wrong
//
// D never got an entry at all. The effect fires on every tier change, and
// opening an audit resets the tier to Full, so it ran for a change nobody
// made, reading the audit id from whichever render it had closed over, and
// filed the newly opened audit's default under the previous audit's key.
//
// The fix is not a longer dependency array. It is that adoption does not write
// at all: the map is written at the click, where the audit is whichever one the
// finish screen belongs to, and reading it is all that opening an audit does.
//
// These tests model the flow rather than the helpers, because the helpers were
// already correct and passed while production was broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  rememberTier, rememberedTier, tierForOpenAudit, auditScopedReset, mergeDeviceState,
  DEFAULT_TIER,
} from '../src/framework/auditSession.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');

const C = 'ceddb6bb-22a9-4ef6-8417-604840b6a995';
const D = '8781e1cc-831e-4d3e-b429-94ddc423747b';

/** The console, as far as the tier is concerned. */
const session = () => ({ auditId: null, auditTier: DEFAULT_TIER });

/** chooseTier: the only thing that writes. */
function chooseTier(state, device, tier) {
  state.auditTier = tier;
  if (!state.auditId) return device;
  device.tiersByAudit = rememberTier(device.tiersByAudit, state.auditId, tier);
  return device;
}

/**
 * Opening an audit: resume, reload or starting a new one. Reads the map and
 * the row, writes neither. The stale-closure write lived here and is gone.
 */
function openAudit(state, device, auditId, { rowTier = null, published = false } = {}) {
  state.auditId = auditId;
  const fresh = auditScopedReset({
    tier: tierForOpenAudit({ rowTier, remembered: rememberedTier(device.tiersByAudit, auditId), published }),
  });
  state.auditTier = fresh.auditTier;
  return fresh;
}

// ── the live failure, A to F ────────────────────────────────────────────────

test('A-F. the exact production round trip: C Spot, open D, return to C', () => {
  const device = {};
  const state = session();

  // A. C is open and set to Spot.
  openAudit(state, device, C);
  chooseTier(state, device, 'spot');
  assert.equal(device.tiersByAudit[C], 'spot', 'A. C is recorded as Spot');

  // B and C. D is opened. Its row is a draft, so it carries no tier.
  const dFresh = openAudit(state, device, D, { rowTier: null });
  assert.equal(dFresh.auditTier, 'full', 'C. D initialises Full');
  assert.equal(state.auditTier, 'full');

  // D. The map is untouched by opening D. This is the assertion the live test
  // failed on: C's entry had become "full" and D had none.
  assert.deepEqual(device.tiersByAudit, { [C]: 'spot' }, 'D. C still Spot, D absent');
  assert.equal(rememberedTier(device.tiersByAudit, D), null, 'D has no remembered tier');

  // E and F. Back to C.
  const cAgain = openAudit(state, device, C, { rowTier: null });
  assert.equal(cAgain.auditTier, 'spot', 'F. C resolves Spot');
  assert.equal(state.auditTier, 'spot');
  assert.deepEqual(device.tiersByAudit, { [C]: 'spot' }, 'and the map is still only what was chosen');
});

test('the defect, reproduced: writing on every tier change loses C', () => {
  // The first implementation, modelled: adoption writes too.
  const device = {};
  const state = session();
  const adoptAndWrite = (auditId, staleIdAtWriteTime) => {
    state.auditId = auditId;
    const fresh = auditScopedReset({ tier: tierForOpenAudit({ remembered: rememberedTier(device.tiersByAudit, auditId) }) });
    state.auditTier = fresh.auditTier;
    device.tiersByAudit = rememberTier(device.tiersByAudit, staleIdAtWriteTime, fresh.auditTier);
  };

  openAudit(state, device, C);
  chooseTier(state, device, 'spot');
  adoptAndWrite(D, C);                       // the effect fires with the old id

  assert.equal(device.tiersByAudit[C], 'full', 'C was overwritten with D\'s default');
  assert.equal(rememberedTier(device.tiersByAudit, D), null, 'and D got nothing');
  assert.equal(openAudit(state, device, C).auditTier, 'full', 'so C comes back Full');
});

test('opening an audit writes nothing at all, whatever its tier resolves to', () => {
  const device = { tiersByAudit: rememberTier(undefined, C, 'spot') };
  const before = JSON.stringify(device);
  const state = session();

  openAudit(state, device, D);                       // resolves Full
  openAudit(state, device, C);                       // resolves Spot
  openAudit(state, device, 'never-seen-before');     // resolves Full
  assert.equal(JSON.stringify(device), before, 'the map is read-only during adoption');
});

test('a brand-new audit with no id records nothing, and inherits nothing', () => {
  const device = { tiersByAudit: rememberTier(undefined, C, 'spot') };
  const state = session();
  state.auditId = null;
  chooseTier(state, device, 'desk');
  assert.deepEqual(device.tiersByAudit, { [C]: 'spot' }, 'no id, no entry');
  assert.equal(state.auditTier, 'desk', 'the screen still shows the choice');
});

// ── the rest of the contract ────────────────────────────────────────────────

test('Spot survives a reload', () => {
  const device = {};
  const state = session();
  openAudit(state, device, C);
  chooseTier(state, device, 'spot');

  const reloaded = JSON.parse(JSON.stringify(mergeDeviceState(device, {
    prop: { name: 'C' }, audit: {}, ids: { auditId: C }, auditTier: 'spot', pendingQueue: { v: 1, entries: [] },
  })));
  const after = session();
  assert.equal(openAudit(after, reloaded, C).auditTier, 'spot');
});

test('two audits hold their own tiers at once', () => {
  const device = {};
  const state = session();
  openAudit(state, device, C); chooseTier(state, device, 'spot');
  openAudit(state, device, D); chooseTier(state, device, 'desk');
  assert.deepEqual(device.tiersByAudit, { [C]: 'spot', [D]: 'desk' });
  assert.equal(openAudit(state, device, C).auditTier, 'spot');
  assert.equal(openAudit(state, device, D).auditTier, 'desk');
});

test('a published row\'s tier outranks anything remembered', () => {
  const device = { tiersByAudit: rememberTier(undefined, C, 'spot') };
  const state = session();
  assert.equal(openAudit(state, device, C, { rowTier: 'full', published: true }).auditTier, 'full');
  assert.equal(device.tiersByAudit[C], 'spot', 'and the device record is not rewritten by that');
  // The same row, still a draft: its 'full' is a default and loses to Spot.
  assert.equal(openAudit(state, device, C, { rowTier: 'full' }).auditTier, 'spot');
});

// ── the wiring ──────────────────────────────────────────────────────────────

test('the tier buttons write, and the effect does not', () => {
  assert.match(APP, /onClick=\{\(\) => chooseTier\(t\.id\)\}/, 'the buttons call chooseTier');
  assert.match(APP, /const chooseTier = useCallback\(\(tier\) => \{\s*\n\s*setAuditTier\(tier\);\s*\n\s*persistTier\(ids\.auditId, tier\);/);
  assert.match(APP, /\}, \[ids\.auditId, persistTier\]\);/, 'and it is rebuilt when the open audit changes');

  const effect = APP.slice(APP.indexOf('// The durable per-audit record is written by chooseTier'), APP.indexOf('// creates (or reuses) the property + audit rows'));
  assert.equal(/persistTier/.test(effect), false, 'the auditTier effect no longer writes the map');
  // One call site. The declaration is `const persistTier = useCallback(`, which
  // has no paren after the name and so does not match this pattern.
  assert.equal((APP.match(/persistTier\(/g) || []).length, 1, 'called from exactly one place: chooseTier');
  assert.equal(/setAuditTier\(t\.id\)/.test(APP), false, 'no button bypasses chooseTier');
});

test('adoption paths only read the map', () => {
  for (const path of ['rememberedTier(cached ? JSON.parse(cached).tiersByAudit : null, row.id)',
                      'rememberedTier(data.tiersByAudit, data.ids && data.ids.auditId)']) {
    assert.ok(APP.includes(path), `${path.slice(0, 40)}… is a read`);
  }
  const resume = APP.slice(APP.indexOf('const resumeAudit'), APP.indexOf('const closeReviewAudit'));
  assert.equal(/persistTier|rememberTier\(/.test(resume), false, 'resume never writes a tier');
});

test('an unpublished tier is still never written to the row', () => {
  assert.match(APP, /status: 'published',[\s\S]{0,200}tier,/, 'publish writes it, as it always has');
  const persistTierFn = APP.slice(APP.indexOf('const persistTier'), APP.indexOf('const chooseTier'));
  assert.equal(/supabase|from\('audits'\)/.test(persistTierFn), false, 'the device record touches no table');
});

test('the audit-scoped reset still isolates everything else', () => {
  const fresh = auditScopedReset({ tier: 'spot' });
  assert.equal(fresh.summaryDraft, '');
  assert.equal(fresh.legacyAck, false);
  assert.deepEqual(fresh.photos, {});
  assert.deepEqual(fresh.pendingCaptions, []);
  assert.equal(fresh.publication, null);
  assert.equal(fresh.publicToken, null);
});
