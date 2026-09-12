// Phase 7.2 — the link the console shares.
//
// speculaone-web now reads a report through public.get_public_report, by exact
// token or exact ref, and anon can no longer list audits. New reports are
// shared by their token; every ref link already issued keeps working, so the
// console never rewrites a ref and never touches a token.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicReportLink, REPORT_PAGE } from '../src/framework/reportIdentifier.js';

const APP = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');
// Made up. Real tokens are access credentials and never belong in a test.
const TOKEN = '3f2a9c1e-7b4d-4e8a-9c0f-1d2e3f4a5b6c';

test('a report with a known token is shared by its token, not its ref', () => {
  assert.equal(publicReportLink({ publicToken: TOKEN, ref: 'AHP-2026-9F3C7A2B' }), `speculaone.com/report.html?token=${TOKEN}`);
  assert.equal(REPORT_PAGE, 'speculaone.com/report.html');
});

test('until the token is known the ref link is shown, which still opens the report', () => {
  assert.equal(publicReportLink({ publicToken: null, ref: 'AHP-2026-9F3C7A2B' }), 'speculaone.com/report.html?ref=AHP-2026-9F3C7A2B');
  assert.equal(publicReportLink({ publicToken: 'not-a-token', ref: 'AHP-2026-9F3C7A2B' }), 'speculaone.com/report.html?ref=AHP-2026-9F3C7A2B');
});

test('nothing to link to is no link', () => {
  assert.equal(publicReportLink({}), null);
  assert.equal(publicReportLink(), null);
  assert.equal(publicReportLink({ publicToken: '', ref: '' }), null);
});

test('the console reads the token from the audit row and never writes one', () => {
  assert.match(APP, /snapshot_locked_at, status, published_result, public_token'\)\s*\n\s*\.eq\('id', ids\.auditId\)\.maybeSingle\(\);/);
  assert.match(APP, /setPublicToken\(auditRow \? auditRow\.public_token \|\| null : null\);/);
  assert.match(APP, /useEffect\(\(\) => \{ setPublication\(null\); setPublicToken\(null\); \}, \[ids\.auditId\]\);/,
    'a different audit never shows the previous audit\'s link');
  assert.equal(/public_token\s*[:=]/.test(APP), false, 'no insert or update ever sets public_token');
  // Phase 7.3 adds the third: the audit-scoped reset clears it along with
  // everything else that belongs to the audit being left behind.
  assert.equal((APP.match(/setPublicToken\(/g) || []).length, 3, 'reset per audit, cleared on switch, and read from the row: nowhere else');
});

test('the finish screen shows the generated link, not a hand-built ref URL', () => {
  assert.match(APP, /\{publicReportLink\(\{ publicToken, ref: ids\.auditRef \}\)\}/);
  assert.equal(APP.includes('report.html?ref={'), false);
});

test('refs are still generated exactly as before', () => {
  assert.match(APP, /const ref = genAuditRef\(\);/);
  assert.match(APP, /\.insert\(\{ ref, property_id: propertyId, auditor_id: userId, status: 'draft' \}\)/);
});
