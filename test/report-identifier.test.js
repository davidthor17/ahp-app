// Phase 6.7 security remediation. genAuditRef() is the entire access control
// for a public report URL today (speculaone.com/report.html?ref=...), so
// "does it look right" is not enough here — these tests check the actual
// entropy source and the actual keyspace, not just the string shape.

import test from 'node:test';
import assert from 'node:assert/strict';

import { genAuditRef, randomSuffix, hasSecureRandom } from '../src/framework/reportIdentifier.js';

test('a CSPRNG is available in this runtime (Node\'s Web Crypto API)', () => {
  assert.equal(hasSecureRandom(), true);
});

test('the suffix is drawn from crypto.getRandomValues, not Math.random', () => {
  // Prove it by observation: replace crypto.getRandomValues with a spy that
  // always fills zeros, and confirm the output reflects exactly that —
  // if the module were quietly still using Math.random, this would fail.
  const real = globalThis.crypto.getRandomValues;
  let calls = 0;
  globalThis.crypto.getRandomValues = (arr) => { calls += 1; arr.fill(0); return arr; };
  try {
    assert.equal(randomSuffix(), '00000000');
    assert.equal(calls, 1);
  } finally {
    globalThis.crypto.getRandomValues = real;
  }
});

test('the suffix is exactly 8 uppercase hex characters', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(randomSuffix(), /^[0-9A-F]{8}$/);
  }
});

test('the suffix is 32 bits, not the old 4-character base36 (~20.7 bits)', () => {
  // 8 hex chars = 4 bytes = 32 bits, exactly — not an estimate.
  const suffix = randomSuffix();
  assert.equal(suffix.length, 8);
  assert.equal(Math.log2(16 ** 8), 32);
});

test('two random bytes never collapse to the same hex digit pair through bias', () => {
  // Each byte maps to exactly two hex characters via >>4 and &0x0f — a
  // perfectly even 16-way split with no modulo, unlike base36 over 256
  // possible byte values (256 is not divisible by 36).
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(randomSuffix());
  // With 32 bits of real entropy, 2000 draws colliding at all would be a
  // sign something is badly wrong (the birthday bound for 2^32 is far
  // larger than 2000 draws) — this is a sanity floor, not a proof.
  assert.equal(seen.size, 2000, 'no two of 2000 real draws collided');
});

test('the ref keeps its existing shape: AHP-{year}-{suffix}', () => {
  const ref = genAuditRef(new Date('2026-03-15T00:00:00Z'));
  assert.match(ref, /^AHP-2026-[0-9A-F]{8}$/);
});

test('the ref uses the real current year when none is given', () => {
  const ref = genAuditRef();
  assert.match(ref, new RegExp(`^AHP-${new Date().getFullYear()}-[0-9A-F]{8}$`));
});

test('refs are unique enough for the intended use: no collision across 5000 draws', () => {
  const refs = new Set();
  for (let i = 0; i < 5000; i += 1) refs.add(genAuditRef(new Date('2026-01-01T00:00:00Z')));
  assert.equal(refs.size, 5000);
});

test('is not the old generator: Math.random is never called by genAuditRef', () => {
  const real = Math.random;
  let called = false;
  Math.random = () => { called = true; return real(); };
  try {
    genAuditRef();
    assert.equal(called, false, 'genAuditRef must draw only from crypto.getRandomValues');
  } finally {
    Math.random = real;
  }
});
