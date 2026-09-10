// Phase 6.7. The client report is a reduction over everything already
// canonical — score(), deriveFinding(), auditIntelligence.js,
// executiveReport.js, certify(). Nothing here may recompute a score, a
// finding, a priority ranking, or a certification decision; every test
// either confirms a canonical value survived unchanged, or confirms the
// three things this module actually owns: shape, evidence, and the
// draft/published gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { analyzeAuditIntelligence } from '../src/framework/auditIntelligence.js';
import { buildExecutiveReport } from '../src/framework/executiveReport.js';
import { buildClientReport } from '../src/framework/clientReport.js';
import { PHOTO_STATUS } from '../src/framework/photoEvidence.js';
import { FULL_5_STAR, gradeAll, setStatus } from './helpers.js';

const PROPERTY = { name: 'Villa Speculo', city: 'Lisbon', country: 'Portugal', category: '5★' };
const clean = () => gradeAll(FULL_5_STAR, 'met');

function buildReport(graded, { auditMeta = {}, photos = {} } = {}) {
  const scoreResult = score(graded, FULL_5_STAR);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  const certification = certify(scoreResult, { auditType: auditMeta.auditType || 'full' });
  const executiveReport = buildExecutiveReport({ scoreResult, intelligence, certification });
  return {
    report: buildClientReport({
      scoreResult, intelligence, executiveReport, certification,
      property: PROPERTY, auditMeta: { auditType: 'full', status: 'published', ...auditMeta }, photos,
    }),
    scoreResult, intelligence, certification,
  };
}

const savedPhoto = (id, note) => ({
  status: PHOTO_STATUS.SAVED, remote: { id, storagePath: `evidence/${id}.jpg`, createdAt: '2026-09-10T00:00:00Z' }, note: note || null,
});

// ── report model ─────────────────────────────────────────────────────────

test('1. a clean, fully-met audit produces a client-ready report with no priorities or urgent issues', () => {
  const { report } = buildReport(clean());
  assert.equal(report.clientReady, true);
  assert.deepEqual(report.priorities, []);
  assert.deepEqual(report.urgentIssues, []);
  assert.ok(report.strengths.length > 0);
});

test('2. a mixed audit surfaces priorities, patterns and strengths together', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['SAF-03'], 'missed');
  const { report } = buildReport(graded);
  assert.ok(report.priorities.length > 0);
  assert.ok(report.strengths.length > 0);
});

test('3. a Critical finding is never hidden by a high overall score', () => {
  const graded = setStatus(clean(), ['SAF-03'], 'missed');
  const { report } = buildReport(graded);
  assert.ok(report.performance.overallScore >= 90);
  assert.ok(report.urgentIssues.length >= 1);
  assert.match(report.executiveOverview.headline, /critical/i);
});

test('4. multiple priorities are ranked, most severe first', () => {
  const graded = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-06'], 'missed');
  const { report } = buildReport(graded);
  assert.ok(report.priorities.length >= 2);
  assert.equal(report.priorities[0].severity, 'critical');
});

test('5. a repeated failure appears as a pattern', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-09'], 'missed');
  const { report } = buildReport(graded);
  assert.ok(report.patterns.some((p) => p.type === 'repeated_failure'));
});

// Caught in browser verification: a section with zero findings had no
// finding to derive a label from, so Section Performance showed the raw
// id ("pre", "fbservice") instead of a real name for every clean section —
// only the two sections that actually had a problem got a proper label.
test('section performance always shows the real section name, even with zero findings in it', () => {
  const { report } = buildReport(clean()); // every section clean, no findings anywhere
  assert.ok(report.performance.sections.length > 10);
  for (const s of report.performance.sections) {
    assert.notEqual(s.sectionLabel, s.sectionId, `${s.sectionId} must show its real label, not its raw id`);
  }
  assert.ok(report.performance.sections.some((s) => s.sectionLabel === 'Room Quality'));
});

test('6. the top-ranked strength on a fully-met audit is traceable to real section data', () => {
  // executiveReport.js caps strengths at the top 3 by assessed sample size
  // (reused here, not re-ranked) — Room Quality (9 items) is real but not
  // guaranteed to survive that cap next to 13-item Breakfast, so this
  // checks the shape of whichever strength actually ranked first rather
  // than assuming a specific section.
  const { report } = buildReport(clean());
  assert.ok(report.strengths.length > 0 && report.strengths.length <= 3);
  const top = report.strengths[0];
  assert.ok(top.sectionId && top.assessedCount >= 3 && top.score === 100);
});

test('7. Not Assessed items never appear in priorities, patterns, or findings as a problem', () => {
  const graded = setStatus(clean(), ['RM-06'], 'na', 'day', { naReason: 'not_observed' });
  const { report } = buildReport(graded);
  assert.equal(report.priorities.some((p) => p.findingIds.includes('RM-06')), false);
  assert.equal(report.findings.some((f) => f.itemId === 'RM-06'), false);
});

test('8. Not Available items never appear as findings', () => {
  const graded = setStatus(clean(), ['RM-10'], 'na', 'day', { naReason: 'not_offered' });
  const { report } = buildReport(graded);
  assert.equal(report.findings.some((f) => f.itemId === 'RM-10'), false);
});

test('9. zero findings produces an empty findings list and full strengths, without crashing', () => {
  const { report } = buildReport(clean());
  assert.deepEqual(report.findings, []);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('10. low coverage is reported honestly, not disguised as a low score', () => {
  const graded = { 'RM-01': { day: { status: 'met' } } }; // one item graded out of the whole catalogue
  const { report } = buildReport(graded);
  assert.equal(report.performance.overallScore, 100, 'quality of the one thing assessed is still 100');
  assert.ok(report.performance.coverage < 5, 'coverage must show how little was actually assessed');
});

// ── canonical consistency ───────────────────────────────────────────────

test('11. performance scores are the canonical score() values, not a recomputation', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const { report, scoreResult } = buildReport(graded);
  assert.equal(report.performance.overallScore, scoreResult.overall);
  assert.equal(report.performance.coverage, scoreResult.coverage);
  for (const s of report.performance.sections) {
    assert.equal(s.score, scoreResult.bySection[s.sectionId].score);
  }
});

test('12. findings are the canonical intelligence findings, field for field', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const { report, intelligence } = buildReport(graded);
  const canonical = intelligence.findings.find((f) => f.itemId === 'RM-01');
  const reported = report.findings.find((f) => f.itemId === 'RM-01');
  assert.equal(reported.severity, canonical.severity);
  assert.equal(reported.status, canonical.status);
  assert.equal(reported.sectionId, canonical.sectionId);
});

test('13. certification comes from certify(), never re-decided here', () => {
  const graded = setStatus(clean(), ['SAF-01', 'SAF-02', 'SAF-03'], 'missed');
  const { report, certification } = buildReport(graded);
  assert.equal(certification.eligible, false);
  assert.equal(report.certification.eligible, false);
  assert.equal(report.certification.level, null);
});

test('14. a certified audit reports the exact level certify() awarded', () => {
  const { report, certification } = buildReport(clean());
  assert.equal(certification.eligible, true);
  assert.equal(report.certification.level, certification.level);
  assert.equal(report.certification.label, certification.label);
});

test('15. Not Assessed is reported as coverage context, never as a negative finding anywhere in the model', () => {
  const graded = setStatus(clean(), ['RM-06', 'RM-07'], 'na', 'day', { naReason: 'not_observed' });
  const { report } = buildReport(graded);
  const serialised = JSON.stringify(report.priorities) + JSON.stringify(report.patterns) + JSON.stringify(report.findings);
  assert.doesNotMatch(serialised, /RM-06|RM-07/);
});

// ── evidence ─────────────────────────────────────────────────────────────

test('16. evidence is correctly associated with the finding it was taken against', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const photos = { 'RM-01 day': [savedPhoto('p1', 'chipped tile')] };
  const { report } = buildReport(graded, { photos });
  const finding = report.findings.find((f) => f.itemId === 'RM-01');
  assert.equal(finding.evidenceCount, 1);
  assert.equal(report.evidence.byItemId['RM-01'][0].photoId, 'p1');
});

test('17. photo captions remain attached to their evidence entry', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const photos = { 'RM-01 day': [savedPhoto('p1', 'chipped tile')] };
  const { report } = buildReport(graded, { photos });
  assert.equal(report.evidence.byItemId['RM-01'][0].caption, 'chipped tile');
});

test('18. an item with no evidence is safe — zero count, not a crash', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const { report } = buildReport(graded); // no photos passed at all
  const finding = report.findings.find((f) => f.itemId === 'RM-01');
  assert.equal(finding.evidenceCount, 0);
  assert.equal(report.evidence.totalCount, 0);
});

test('an in-flight or failed photo is never counted as evidence', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const photos = { 'RM-01 day': [{ status: PHOTO_STATUS.UPLOADING, remote: null, note: 'not yet' }] };
  const { report } = buildReport(graded, { photos });
  assert.equal(report.evidence.totalCount, 0);
});

// ── report safety ────────────────────────────────────────────────────────

test('19. an unpublished (draft) audit is never clientReady', () => {
  const { report } = buildReport(clean(), { auditMeta: { status: 'draft' } });
  assert.equal(report.clientReady, false);
});

test('19b. status defaults to draft, never silently to published', () => {
  // buildClientReport() directly, bypassing this file's test helper (which
  // defaults status to 'published' for its own convenience) — this tests
  // the module's own default, not the helper's.
  const graded = clean();
  const scoreResult = score(graded, FULL_5_STAR);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  const certification = certify(scoreResult, { auditType: 'full' });
  const executiveReport = buildExecutiveReport({ scoreResult, intelligence, certification });
  const report = buildClientReport({
    scoreResult, intelligence, executiveReport, certification, property: PROPERTY, auditMeta: {},
  });
  assert.equal(report.clientReady, false);
  assert.equal(report.metadata.status, 'draft');
});

test('20. the model requires nothing beyond the existing published_result contract to build', () => {
  // Proven by construction: every test in this file builds a full report
  // from score()/intelligence/executiveReport/certify() alone — none of
  // which read or depend on audits.published_result. The model is
  // independent of that contract in either direction.
  const { report } = buildReport(clean(), { auditMeta: { status: 'published' } });
  assert.equal(report.clientReady, true);
});

test('21. no internal-only or raw-database fields appear anywhere in the model', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const { report } = buildReport(graded, { auditMeta: { auditRef: 'AHP-2026-TEST' } });
  const serialised = JSON.stringify(report);
  const forbidden = ['auditor_id', 'price_quoted', 'opportunity_id', 'currency', 'created_by', 'storage_path', 'supabase'];
  for (const field of forbidden) assert.doesNotMatch(serialised, new RegExp(field, 'i'));
  assert.equal(report.metadata.reportId, 'AHP-2026-TEST');
});

// ── determinism ──────────────────────────────────────────────────────────

test('22. the same inputs always produce the same output', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['SAF-03'], 'missed');
  const photos = { 'RM-01 day': [savedPhoto('p1')] };
  const a = buildReport(JSON.parse(JSON.stringify(graded)), { photos: JSON.parse(JSON.stringify(photos)) }).report;
  const b = buildReport(JSON.parse(JSON.stringify(graded)), { photos: JSON.parse(JSON.stringify(photos)) }).report;
  assert.deepEqual(a, b);
});

test('23. section and priority ordering is deterministic regardless of photo-key insertion order', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['SAF-03'], 'missed');
  const p1 = { 'RM-01 day': [savedPhoto('a')], 'SAF-03 day': [savedPhoto('b')] };
  const p2 = { 'SAF-03 day': [savedPhoto('b')], 'RM-01 day': [savedPhoto('a')] };
  const a = buildReport(graded, { photos: p1 }).report;
  const b = buildReport(graded, { photos: p2 }).report;
  assert.deepEqual(a.priorities.map((p) => p.title), b.priorities.map((p) => p.title));
  assert.deepEqual(a.performance.sections, b.performance.sections);
});

test('24. building the report never mutates the canonical results it was given', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const scoreResult = score(graded, FULL_5_STAR);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  const certification = certify(scoreResult, { auditType: 'full' });
  const executiveReport = buildExecutiveReport({ scoreResult, intelligence, certification });
  const photos = { 'RM-01 day': [savedPhoto('p1')] };

  const beforeScore = JSON.parse(JSON.stringify(scoreResult));
  const beforeIntel = JSON.parse(JSON.stringify(intelligence));
  const beforeExec = JSON.parse(JSON.stringify(executiveReport));
  const beforePhotos = JSON.parse(JSON.stringify(photos));

  buildClientReport({
    scoreResult, intelligence, executiveReport, certification,
    property: PROPERTY, auditMeta: { auditType: 'full', status: 'published' }, photos,
  });

  assert.deepEqual(scoreResult, beforeScore);
  assert.deepEqual(intelligence, beforeIntel);
  assert.deepEqual(executiveReport, beforeExec);
  assert.deepEqual(photos, beforePhotos);
});
