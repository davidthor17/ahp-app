// Phase 6.7 security remediation, item 17 of the required regression list:
// no service-role key or other secret credential may ever be referenced from
// client-side source. The console legitimately embeds a publishable/anon
// key — that key is meant to be public, ships in the bundle by design, and
// is safe only because the database boundary (RLS plus, since this phase,
// the column grants in migrations/2026-09-10-phase67-public-report-security.sql)
// enforces what it may see. A service-role key would bypass that boundary
// entirely, so its presence anywhere in src/ is a hard failure, not a style
// issue.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

test('there is client source to check, so this test is not vacuous', () => {
  assert.ok(files.length > 10, `expected many source files, found ${files.length}`);
});

test('no service-role key, secret key, or Supabase secret prefix appears anywhere in src/', () => {
  const forbidden = [
    /service_role/i,
    /service-role/i,
    /SERVICE_ROLE_KEY/,
    /sb_secret_/, // Supabase's newer secret-key prefix — sb_publishable_ is the safe one already in use
    /supabaseServiceRole/i,
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${path.relative(SRC, file)} matches ${pattern} — a secret must never reach client source`);
    }
  }
});

test('the only Supabase credential embedded is the publishable/anon key, and it is recognisably public', () => {
  const appJsx = readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
  const match = appJsx.match(/const SUPABASE_ANON_KEY = "([^"]+)"/);
  assert.ok(match, 'SUPABASE_ANON_KEY must be defined exactly once, as a plain constant');
  // Supabase's two safe-for-client-code key shapes: the legacy JWT anon key
  // (role: "anon", decodable, never role: "service_role") or the newer
  // sb_publishable_ prefix. Neither can authorize anything RLS/grants do not.
  const key = match[1];
  const isPublishable = key.startsWith('sb_publishable_');
  const isLegacyAnonJwt = key.split('.').length === 3; // header.payload.signature
  assert.ok(isPublishable || isLegacyAnonJwt, 'the embedded key must be a publishable or legacy anon key, not an opaque secret');
  assert.equal(key.startsWith('sb_secret_'), false);
});

test('createClient is called with the anon key alone — no service-role client is constructed anywhere', () => {
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const calls = text.match(/createClient\([^)]*\)/g) || [];
    for (const call of calls) {
      assert.equal(/service/i.test(call), false, `${path.relative(SRC, file)}: ${call}`);
    }
  }
});
