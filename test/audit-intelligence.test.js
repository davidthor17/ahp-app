// Phase 6.5. The intelligence engine aggregates and ranks findings that
// scoring.js and findings.js already derived — it must never invent a
// finding, a severity, or a score of its own. Every test here either
// confirms a fact already proven by scoring.test.js / findings.test.js is
// carried through unchanged, or confirms the aggregation rules (ranking,
// grouping, thresholds) documented in auditIntelligence.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { SEVERITY } from '../src/framework/weights.js';
import {
  analyzeAuditIntelligence, buildPriorities, buildPatterns, buildSummaryMetrics,
} from '../src/framework/auditIntelligence.js';
import { FULL_5_STAR, gradeAll, setStatus } from './helpers.js';

// RM-01 Major/Condition, RM-02 Critical/Condition/ZT-eligible, RM-06
// Minor/Product, RM-09 Minor/Condition — real catalogue metadata (items.js),
// not fixture-invented. SAF-01/02 Critical/Condition/ZT-eligible,
// SAF-03 Critical/Service — the smallest real section, 3 items.
const clean = () => gradeAll(FULL_5_STAR, 'met');
const analyze = (graded) => analyzeAuditIntelligence({
  scoreResult: score(graded, FULL_5_STAR), audit: graded, profile: FULL_5_STAR,
});

// ── findings ─────────────────────────────────────────────────────────────

test('1. a clean audit produces no findings', () => {
  const r = analyze(clean());
  assert.deepEqual(r.findings, []);
});

test('2. an existing missed finding appears, unchanged', () => {
  const graded = setStatus(clean(), ['RM-01'], 'missed');
  const r = analyze(graded);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].itemId, 'RM-01');
  assert.equal(r.findings[0].status, 'missed');
  assert.equal(r.findings[0].severity, 'major');
});

test('3. an existing partial finding appears, stepped down as findings.js defines', () => {
  const graded = setStatus(clean(), ['RM-01'], 'partial'); // Major -> Minor
  const r = analyze(graded);
  assert.equal(r.findings[0].status, 'partial');
  assert.equal(r.findings[0].severity, 'minor');
  assert.equal(r.findings[0].derivedSeverity, 'minor');
});

test('4. a Zero Tolerance escalation is preserved exactly', () => {
  const graded = setStatus(clean(), ['RM-02'], 'missed', 'day', {
    escalation: { severity: 'zero_tolerance', note: 'Evidence of bodily fluids on the sheets.', evidence: 'photo-1' },
  });
  const r = analyze(graded);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, 'zero_tolerance');
  assert.equal(r.findings[0].escalated, true);
  assert.equal(r.findings[0].source, 'auditor');
  assert.equal(r.findings[0].note, 'Evidence of bodily fluids on the sheets.');
});

test('5. the item\'s default severity is preserved on the finding', () => {
  const graded = setStatus(clean(), ['RM-06'], 'missed'); // Minor/Product by catalogue
  const r = analyze(graded);
  assert.equal(r.findings[0].defaultSeverity, 'minor');
  assert.equal(r.findings[0].dimension, 'product');
  assert.equal(r.findings[0].sectionId, 'room');
});

// ── priorities ───────────────────────────────────────────────────────────

test('6. Zero Tolerance always ranks first', () => {
  const graded = setStatus(
    setStatus(clean(), ['SAF-03'], 'missed'), // Critical, no escalation
    ['RM-02'], 'missed', 'day', { escalation: { severity: 'zero_tolerance', note: 'n', evidence: 'e' } },
  );
  const r = analyze(graded);
  assert.equal(r.priorities[0].severity, 'zero_tolerance');
  assert.equal(r.priorities[0].rank, 1);
});

test('7. Critical ranks above Minor', () => {
  const graded = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-06'], 'missed');
  const r = analyze(graded);
  const critical = r.priorities.find((p) => p.severity === 'critical');
  const minor = r.priorities.find((p) => p.severity === 'minor');
  assert.ok(critical.rank < minor.rank);
});

test('8. a repeated issue in one section outranks an isolated one of the same severity', () => {
  // RM-01 and RM-09 both Condition items but different default severities —
  // use two Major items in one section against one Major item alone elsewhere
  // is awkward with this catalogue, so this is tested directly against
  // buildPriorities with synthetic-but-shaped-like-real findings, which is
  // legitimate here because the rule under test is buildPriorities' own
  // grouping logic, not anything scoring.js or findings.js computed.
  const f = (itemId, sectionId, sectionLabel) => ({
    itemId, label: itemId, sectionId, sectionLabel, weightClass: 'standard', dimension: 'condition',
    status: 'missed', severity: 'major', defaultSeverity: 'major', derivedSeverity: 'major',
    escalated: false, source: 'derived', note: null, evidence: null,
  });
  const findings = [f('A-1', 'room', 'Room Quality'), f('A-2', 'room', 'Room Quality'), f('B-1', 'bathroom', 'Bathroom')];
  const priorities = buildPriorities(findings);
  const repeated = priorities.find((p) => p.type === 'repeated');
  const isolated = priorities.find((p) => p.type === 'isolated');
  assert.ok(repeated.rank < isolated.rank, 'two in one section outrank one alone, at the same severity');
});

test('9. priority ranking is deterministic regardless of input order', () => {
  const a = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-06'], 'missed');
  const b = setStatus(setStatus(clean(), ['RM-06'], 'missed'), ['SAF-03'], 'missed');
  assert.deepEqual(analyze(a).priorities, analyze(b).priorities);
});

test('10. a clean audit produces no priorities', () => {
  assert.deepEqual(analyze(clean()).priorities, []);
});

// ── strengths ────────────────────────────────────────────────────────────

// RM-08 is Ultra-only (minStars 6) and does not apply at 5★, so nine of the
// ten Room Quality items are the real applicable set under FULL_5_STAR.
const ROOM_IDS_5_STAR = ['RM-01', 'RM-02', 'RM-03', 'RM-04', 'RM-05', 'RM-06', 'RM-07', 'RM-09', 'RM-10'];

test('11. a fully-met, meaningfully-sized section produces a strength', () => {
  const g = {};
  for (const id of ROOM_IDS_5_STAR) g[id] = { day: { status: 'met' } };
  const r = analyze(g);
  const strength = r.strengths.find((s) => s.sectionId === 'room');
  assert.ok(strength, 'Room Quality should qualify');
  assert.equal(strength.assessedCount, ROOM_IDS_5_STAR.length);
  assert.equal(strength.score, 100);
});

test('12. a one-item sample never becomes a strength', () => {
  const r = analyze({ 'SAF-01': { day: { status: 'met' } } });
  assert.equal(r.strengths.find((s) => s.sectionId === 'safety'), undefined);
});

test('13. a section with any missed item is never a strength, however small the mix', () => {
  const g = {};
  for (const id of ROOM_IDS_5_STAR) g[id] = { day: { status: 'met' } };
  g['RM-06'] = { day: { status: 'missed' } }; // one of nine
  const r = analyze(g);
  assert.equal(r.strengths.find((s) => s.sectionId === 'room'), undefined);
});

test('14. strength metrics are exact, not approximated', () => {
  const ids = ['SAF-01', 'SAF-02', 'SAF-03'];
  const g = {};
  for (const id of ids) g[id] = { day: { status: 'met' } };
  const r = analyze(g);
  const s = r.strengths.find((x) => x.sectionId === 'safety');
  assert.deepEqual(s.itemIds, ['SAF-01', 'SAF-02', 'SAF-03']);
  assert.equal(s.assessedCount, 3);
  assert.equal(s.score, 100);
});

// ── patterns ─────────────────────────────────────────────────────────────

test('15. two failures in one section produce a repeated_failure pattern', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-09'], 'missed');
  const r = analyze(graded);
  const p = r.patterns.find((x) => x.type === 'repeated_failure');
  assert.ok(p);
  assert.deepEqual(p.sectionIds, ['room']);
  assert.deepEqual([...p.findingIds].sort(), ['RM-01', 'RM-09']);
});

test('16. one isolated failure produces no repeated_failure pattern', () => {
  const r = analyze({ 'RM-01': { day: { status: 'missed' } } });
  assert.equal(r.patterns.find((p) => p.type === 'repeated_failure'), undefined);
  assert.deepEqual(r.patterns, []);
});

test('17. a cross-section pattern fires only when the same dimension repeats across sections', () => {
  // RM-01 and SAF-01 are both Condition — real, proven metadata.
  const shared = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['SAF-01'], 'missed');
  const withPattern = analyze(shared);
  const p = withPattern.patterns.find((x) => x.type === 'cross_section_dimension');
  assert.ok(p, 'two Condition findings in different sections should connect');
  assert.deepEqual([...p.sectionIds].sort(), ['room', 'safety']);

  // RM-06 is Product, SAF-03 is Service — different dimensions, no connection
  // the catalogue actually supports.
  const unrelated = setStatus(setStatus(clean(), ['RM-06'], 'missed'), ['SAF-03'], 'missed');
  const withoutPattern = analyze(unrelated);
  assert.equal(withoutPattern.patterns.find((x) => x.type === 'cross_section_dimension'), undefined);
});

test('18. a pattern references exactly the findings that produced it', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-09'], 'missed');
  const r = analyze(graded);
  const p = r.patterns.find((x) => x.type === 'repeated_failure');
  const actualIds = r.findings.filter((f) => f.sectionId === 'room').map((f) => f.itemId).sort();
  assert.deepEqual([...p.findingIds].sort(), actualIds);
});

test('19. pattern severity is the worst severity among its findings, not the first or last', () => {
  // RM-01 is Major, RM-02 is Critical — inserted Critical second, so a
  // first-wins or last-wins bug would report the wrong one.
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-02'], 'missed');
  const r = analyze(graded);
  const p = r.patterns.find((x) => x.type === 'repeated_failure' && x.sectionIds[0] === 'room');
  assert.equal(p.severity, 'critical');
});

// ── summary metrics ──────────────────────────────────────────────────────

test('20. summary metrics equal the canonical scoring values, not a recomputation', () => {
  const graded = setStatus(clean(), ['RM-01', 'SAF-03'], 'missed');
  const scoreResult = score(graded, FULL_5_STAR);
  const r = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  assert.equal(r.summaryMetrics.overallScore, scoreResult.overall);
  assert.equal(r.summaryMetrics.coverage, scoreResult.coverage);
  assert.equal(r.summaryMetrics.totalAssessedItems, scoreResult.counts.graded);
  assert.equal(r.summaryMetrics.criticalFindings, scoreResult.findingCounts.critical);
  assert.deepEqual(r.summaryMetrics.findingsBySeverity, scoreResult.findingCounts);
});

test('21. Not Assessed is reported as a plain count, never as a finding or a severity', () => {
  const withNotAssessed = setStatus(clean(), ['RM-06'], 'na', 'day', { naReason: 'not_observed' });
  const r = analyze(withNotAssessed);
  assert.equal(r.findings.length, 0);
  assert.equal(r.summaryMetrics.notAssessedCount, 1);
  assert.equal(r.summaryMetrics.missedCount, 0);
  assert.deepEqual(r.summaryMetrics.findingsBySeverity, { minor: 0, major: 0, critical: 0, zero_tolerance: 0 });
});

test('22. counts are accurate across a mixed audit', () => {
  let graded = clean();
  graded = setStatus(graded, ['RM-01'], 'missed');
  graded = setStatus(graded, ['RM-09'], 'partial');
  graded = setStatus(graded, ['RM-06'], 'na', 'day', { naReason: 'not_observed' });
  graded = setStatus(graded, ['RM-10'], 'na', 'day', { naReason: 'not_offered' });
  const r = analyze(graded);
  assert.equal(r.summaryMetrics.missedCount, 1);
  assert.equal(r.summaryMetrics.partialCount, 1);
  assert.equal(r.summaryMetrics.notAssessedCount, 1);
  assert.equal(r.summaryMetrics.notAvailableCount, 1);
  assert.equal(r.summaryMetrics.totalFindings, 2);
});

test('23. an empty audit is safe and produces zeroed, non-null-crashing metrics', () => {
  const r = analyze({});
  assert.equal(r.summaryMetrics.overallScore, null);
  assert.equal(r.summaryMetrics.totalFindings, 0);
  assert.equal(r.summaryMetrics.totalAssessedItems, 0);
  assert.deepEqual(r.priorities, []);
  assert.deepEqual(r.patterns, []);
  assert.deepEqual(r.strengths, []);
});

test('24. every status, including both kinds of N/A, is handled without throwing', () => {
  let graded = {};
  graded = setStatus(graded, ['RM-01'], 'met');
  graded = setStatus(graded, ['RM-02'], 'partial');
  graded = setStatus(graded, ['RM-03'], 'missed');
  graded = setStatus(graded, ['RM-06'], 'na', 'day', { naReason: 'not_observed' });
  graded = setStatus(graded, ['RM-10'], 'na', 'day', { naReason: 'not_offered' });
  assert.doesNotThrow(() => analyze(graded));
});

// ── stability ────────────────────────────────────────────────────────────

test('25. analysis never mutates the score result or the graded audit it was given', () => {
  const graded = setStatus(clean(), ['RM-01', 'SAF-03'], 'missed');
  const scoreResult = score(graded, FULL_5_STAR);
  const beforeScore = JSON.parse(JSON.stringify(scoreResult));
  const beforeAudit = JSON.parse(JSON.stringify(graded));

  analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });

  assert.deepEqual(scoreResult, beforeScore);
  assert.deepEqual(graded, beforeAudit);
});

test('26. the same input always produces the same output', () => {
  const graded = setStatus(clean(), ['RM-01', 'RM-02', 'SAF-03'], 'missed');
  const a = analyze(JSON.parse(JSON.stringify(graded)));
  const b = analyze(JSON.parse(JSON.stringify(graded)));
  assert.deepEqual(a, b);
});

test('27. output ordering does not depend on object key insertion order', () => {
  const g1 = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['SAF-03'], 'missed');
  const g2 = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-01'], 'missed');
  const r1 = analyze(g1);
  const r2 = analyze(g2);
  assert.deepEqual(r1.priorities.map((p) => p.title), r2.priorities.map((p) => p.title));
  assert.deepEqual(r1.patterns.map((p) => p.title), r2.patterns.map((p) => p.title));
});

// ── additional: consistency_gap, the third pattern type ─────────────────

test('a section with real weight on both sides produces a consistency_gap pattern', () => {
  const g = {};
  for (const id of ROOM_IDS_5_STAR) g[id] = { day: { status: 'met' } };
  g['RM-01'] = { day: { status: 'missed' } };
  g['RM-09'] = { day: { status: 'partial' } };
  const r = analyze(g);
  const p = r.patterns.find((x) => x.type === 'consistency_gap' && x.sectionIds[0] === 'room');
  assert.ok(p, 'seven met against two not-met, in a nine-item section, is a genuine mix');
});

test('summaryMetrics.priorityCount/patternCount/strengthCount match the returned arrays', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-09'], 'missed');
  const r = analyze(graded);
  assert.equal(r.summaryMetrics.priorityCount, r.priorities.length);
  assert.equal(r.summaryMetrics.patternCount, r.patterns.length);
  assert.equal(r.summaryMetrics.strengthCount, r.strengths.length);
});
