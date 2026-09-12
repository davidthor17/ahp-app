// Phase 7.3C — whose tier wins, and when.
//
// The live round trip failed twice. The second failure was this: the map was
// correct, holding { C: "spot" }, and resuming C still resolved Full. Both
// adoption paths read the row's tier first and treated it as authoritative.
//
// audits.tier defaults to 'full'. Every draft row therefore says "full"
// whether or not anybody chose it, so reading the row first made the per-audit
// map unreachable for exactly the audits it exists to serve. The row is a
// decision only once publishAudit has written the chosen tier to it.
//
//   published row tier    what was issued; nothing may override it
//   remembered tier       the only record a draft's choice has
//   draft row tier        a column default, used when nothing was remembered
//   Full                  what an audit with no recorded tier always was

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tierForOpenAudit, rememberTier, rememberedTier, DEFAULT_TIER } from '../src/framework/auditSession.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');
const C = 'ceddb6bb-22a9-4ef6-8417-604840b6a995';

// ── A ───────────────────────────────────────────────────────────────────────

test('A. a draft\'s remembered tier beats the row default', () => {
  // The exact production case: C's row says full because that is the column
  // default, and the auditor chose Spot.
  assert.equal(
    tierForOpenAudit({ rowTier: 'full', remembered: 'spot', published: false }),
    'spot',
  );
  const map = rememberTier(undefined, C, 'spot');
  assert.equal(
    tierForOpenAudit({ rowTier: 'full', remembered: rememberedTier(map, C), published: false }),
    'spot',
    'read through the map exactly as the console reads it',
  );
});

// ── B ───────────────────────────────────────────────────────────────────────

test('B. a draft with nothing remembered falls back to the row, then Full', () => {
  assert.equal(tierForOpenAudit({ rowTier: 'full', remembered: null, published: false }), 'full');
  assert.equal(tierForOpenAudit({ rowTier: 'spot', remembered: null, published: false }), 'spot',
    'a draft row that does carry a real tier is still better than nothing');
  assert.equal(tierForOpenAudit({ rowTier: null, remembered: null, published: false }), DEFAULT_TIER);
  assert.equal(tierForOpenAudit({}), DEFAULT_TIER);
});

// ── C and D ────────────────────────────────────────────────────────────────

test('C. a published row wins over a remembered tier', () => {
  assert.equal(tierForOpenAudit({ rowTier: 'spot', remembered: 'full', published: true }), 'spot');
});

test('D. a published row wins even when Spot is remembered', () => {
  assert.equal(tierForOpenAudit({ rowTier: 'full', remembered: 'spot', published: true }), 'full');
  assert.equal(tierForOpenAudit({ rowTier: 'desk', remembered: 'spot', published: true }), 'desk');
  // A published row with no tier at all cannot outrank anything: there is
  // nothing to outrank with.
  assert.equal(tierForOpenAudit({ rowTier: null, remembered: 'spot', published: true }), 'spot');
});

test('rubbish is never trusted, published or not', () => {
  assert.equal(tierForOpenAudit({ rowTier: 'gold', remembered: 'spot', published: true }), 'spot');
  assert.equal(tierForOpenAudit({ rowTier: 'full', remembered: 'nonsense', published: false }), 'full');
  assert.equal(tierForOpenAudit({ rowTier: 'nonsense', remembered: 'nonsense' }), DEFAULT_TIER);
});

// ── I: neither adoption path may prefer a draft row ────────────────────────

test('I. resume applies the precedence, with the published flag from the row', () => {
  const resume = APP.slice(APP.indexOf('const resumeAudit'), APP.indexOf('const closeReviewAudit'));
  assert.match(resume, /tierForOpenAudit\(\{[\s\S]{0,400}published: Boolean\(auditRow && auditRow\.status === 'published'\)/);
  assert.match(resume, /remembered: rememberedForThisAudit/);
  assert.equal(/tierForAudit\(/.test(resume), false, 'the old row-only helper is not used here');
});

test('I. the remote pull applies the same precedence and no longer adopts the row blindly', () => {
  const pull = APP.slice(APP.indexOf('// Phase 7.3C. The same precedence the resume path uses'), APP.indexOf('// Phase 7.1. Reloading an audit that was already published'));
  assert.match(pull, /rememberedTier\(cached \? JSON\.parse\(cached\)\.tiersByAudit : null, ids\.auditId\)/, 'it reads the map');
  assert.match(pull, /published: auditRow\.status === 'published'/);
  assert.equal(/if \(auditRow && auditRow\.tier\) \{/.test(pull), false,
    'the unconditional draft-row adopt is gone');
  assert.equal(/tierForAudit\(auditRow\.tier, auditTierRef\.current\)/.test(pull), false);
});

test('I. both adoption paths resolve through the one helper', () => {
  assert.equal((APP.match(/tierForOpenAudit\(\{/g) || []).length, 3,
    'resume, the remote pull, and the cache restore');
});

// ── H: still nothing written to the row before publish ─────────────────────

test('H. no unpublished tier reaches audits.tier', () => {
  assert.match(APP, /status: 'published',[\s\S]{0,200}tier,/, 'publish writes it, as it always has');
  const persistTierFn = APP.slice(APP.indexOf('const persistTier'), APP.indexOf('const chooseTier'));
  assert.equal(/supabase|from\('audits'\)/.test(persistTierFn), false,
    'the device record touches no table');
});
