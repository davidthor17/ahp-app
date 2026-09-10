// Phase 6.6. The executive report reduces what auditIntelligence.js already
// ranked — it must never re-derive a finding, recompute a score, or
// re-order what Phase 6.5 already ordered for a reason. Every test here
// either confirms a canonical value passed through unchanged, or confirms
// the reduction rules (headline, urgent/improvement split, section
// ranking) this module itself is responsible for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { score } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { analyzeAuditIntelligence } from '../src/framework/auditIntelligence.js';
import {
  buildExecutiveReport, performanceBand, buildHeadline, explainPattern,
} from '../src/framework/executiveReport.js';
import { FULL_5_STAR, gradeAll, setStatus } from './helpers.js';

// Real catalogue metadata (items.js): RM-01 Major/Condition, RM-02
// Critical/Condition/ZT-eligible, RM-06 Minor/Product, RM-09
// Minor/Condition, SAF-01 Critical/Condition/ZT-eligible, SAF-03
// Critical/Service. Nothing here is invented.
const clean = () => gradeAll(FULL_5_STAR, 'met');
const report = (graded) => {
  const scoreResult = score(graded, FULL_5_STAR);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  const certification = certify(scoreResult, { auditType: 'full' });
  return buildExecutiveReport({ scoreResult, intelligence, certification });
};

// ── headline ─────────────────────────────────────────────────────────────

test('1/5. a perfect, fully-clean audit reads as exceptional, not merely strong', () => {
  const r = report(clean());
  assert.equal(r.headline, 'Exceptional consistency across the guest experience');
});

test('5b. "no findings" drives the message independent of coverage', () => {
  // Only a handful of items graded, all met; everything else ungraded.
  // hasFindings is false regardless of how little was covered.
  const r = report({ 'RM-01': { day: { status: 'met' } }, 'RM-02': { day: { status: 'met' } } });
  assert.equal(r.headline, 'Exceptional consistency across the guest experience');
});

test('2. a mixed audit with only isolated findings reads as a plain band statement', () => {
  const graded = setStatus(clean(), ['RM-06'], 'missed'); // isolated Minor, no repeat, no pattern
  const r = report(graded);
  assert.equal(r.headline, 'Strong overall performance');
});

test('3. a Critical finding is never hidden behind a high score', () => {
  const graded = setStatus(clean(), ['SAF-03'], 'missed'); // one Critical, score stays high
  const r = report(graded);
  assert.ok(r.performance.overall >= 90, 'the score really is high');
  assert.match(r.headline, /critical issues requiring attention/);
  assert.doesNotMatch(r.headline, /Exceptional|excellent/i);
});

test('4. a Zero Tolerance escalation always reads as a critical operational risk', () => {
  const graded = setStatus(clean(), ['RM-02'], 'missed', 'day', {
    escalation: { severity: 'zero_tolerance', note: 'n', evidence: 'e' },
  });
  const r = report(graded);
  assert.match(r.headline, /critical operational risk/);
});

test('band thresholds are the documented ones', () => {
  assert.equal(performanceBand(95), 'strong');
  assert.equal(performanceBand(90), 'strong');
  assert.equal(performanceBand(89.9), 'good');
  assert.equal(performanceBand(75), 'good');
  assert.equal(performanceBand(50), 'mixed');
  assert.equal(performanceBand(49), 'at_risk');
  assert.equal(performanceBand(null), null);
});

test('an unscored audit says so, not "At Risk"', () => {
  const r = report({});
  assert.equal(r.headline, 'Audit not yet scored');
  assert.equal(r.performance.band, null);
});

// ── priorities ───────────────────────────────────────────────────────────

test('6. priorities are ordered by severity, most severe first', () => {
  const graded = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-06'], 'missed');
  const r = report(graded);
  const severities = r.priorities.map((p) => p.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) =>
    ({ zero_tolerance: 3, critical: 2, major: 1, minor: 0 }[b] - { zero_tolerance: 3, critical: 2, major: 1, minor: 0 }[a])));
});

test('7. a repeated Major cluster is treated as urgent; an isolated Major is not', () => {
  // RM-01 and RM-05 are both Major/Condition in Room Quality — a real
  // repeated-Major cluster, not synthetic data.
  const repeated = report(setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-05'], 'missed'));
  assert.ok(repeated.urgentIssues.some((p) => p.type === 'repeated' && p.severity === 'major'));

  // RM-01 alone, isolated: should NOT be urgent.
  const isolated = report(setStatus(clean(), ['RM-01'], 'missed'));
  assert.equal(isolated.urgentIssues.some((p) => p.findingIds.includes('RM-01')), false);
  assert.equal(isolated.improvementAreas.some((p) => p.findingIds.includes('RM-01')), true);
});

test('8. a priority is linked to the cross-section pattern that shares its section', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['SAF-01'], 'missed'); // both Condition
  const r = report(graded);
  const crossPattern = r.patterns.find((p) => p.type === 'cross_section_dimension');
  assert.ok(crossPattern, 'RM-01 and SAF-01 are both Condition, in different sections');
  const relatedPriority = r.priorities.find((p) => p.relatedPatternIds.includes(crossPattern.id));
  assert.ok(relatedPriority, 'at least one priority should reference the cross-section pattern');
});

test('9. Zero Tolerance is never grouped with another finding', () => {
  const graded = setStatus(setStatus(clean(), ['RM-02'], 'missed', 'day', {
    escalation: { severity: 'zero_tolerance', note: 'n', evidence: 'e' },
  }), ['SAF-01'], 'missed'); // Critical, same dimension, different section
  const r = report(graded);
  const zt = r.priorities.find((p) => p.severity === 'zero_tolerance');
  assert.equal(zt.type, 'zero_tolerance');
  assert.equal(zt.findingIds.length, 1);
});

// ── urgent vs improvement ───────────────────────────────────────────────

test('10. Critical findings are always in urgentIssues', () => {
  const r = report(setStatus(clean(), ['SAF-03'], 'missed'));
  assert.ok(r.urgentIssues.some((p) => p.findingIds.includes('SAF-03')));
});

// Caught in browser verification: the metric read "2 Urgent issues" (a raw
// finding count) while the panel right below it read "URGENT ATTENTION · 1"
// (a priority count), because two grouped Critical findings are one urgent
// priority to act on, not two. The two numbers on one screen must agree.
test('the urgent-issue metric counts priorities, not raw findings, so it never contradicts the panel it sits beside', () => {
  const graded = setStatus(setStatus(clean(), ['SAF-01'], 'missed'), ['SAF-03'], 'missed'); // grouped into one repeated-critical priority
  const r = report(graded);
  assert.equal(r.urgentIssues.length, 1, 'one grouped priority, not two raw findings');
  assert.equal(r.keyMetrics.urgentIssueCount, r.urgentIssues.length);
});

test('11. a 90%+ audit still surfaces its urgent issue', () => {
  const r = report(setStatus(clean(), ['SAF-03'], 'missed'));
  assert.ok(r.performance.overall >= 90);
  assert.equal(r.urgentIssues.length >= 1, true);
  assert.equal(r.decisionSummary.recommendedFocus, 'address_urgent');
});

test('12. an isolated Minor finding never enters urgentIssues', () => {
  const r = report(setStatus(clean(), ['RM-06'], 'missed'));
  assert.equal(r.urgentIssues.length, 0);
  assert.ok(r.improvementAreas.some((p) => p.findingIds.includes('RM-06')));
});

// ── strengths ────────────────────────────────────────────────────────────

test('13. a qualified Phase 6.5 strength appears as a top strength', () => {
  const g = { 'SAF-01': { day: { status: 'met' } }, 'SAF-02': { day: { status: 'met' } }, 'SAF-03': { day: { status: 'met' } } };
  const r = report(g);
  assert.ok(r.strengths.some((s) => s.sectionId === 'safety'));
  assert.equal(r.executiveSummary.positiveSignal, r.strengths[0].title);
});

test('14. an insufficient sample is excluded from strengths, unchanged from Phase 6.5', () => {
  const r = report({ 'SAF-01': { day: { status: 'met' } } });
  assert.equal(r.strengths.find((s) => s.sectionId === 'safety'), undefined);
});

test('15. a strength never overrides an active critical concern', () => {
  const g = {
    'SAF-01': { day: { status: 'met' } }, 'SAF-02': { day: { status: 'met' } }, 'SAF-03': { day: { status: 'missed' } },
  };
  // SAF-03 missed keeps 'safety' from qualifying as a strength itself, but
  // another fully-met section still can, alongside the Critical finding.
  const graded = setStatus(g, ['PRE-01', 'PRE-02', 'PRE-03'], 'met');
  const r = report(graded);
  assert.match(r.headline, /critical/i);
  assert.equal(r.decisionSummary.recommendedFocus, 'address_urgent');
});

// ── patterns ─────────────────────────────────────────────────────────────

test('16. repeated_failure explanation names the count and the section', () => {
  const p = { type: 'repeated_failure', findingIds: ['RM-01', 'RM-09'], sectionLabel: 'Room Quality' };
  assert.equal(explainPattern(p), '2 related failures recorded within Room Quality.');
});

test('17. consistency_gap explanation describes variance, not a verdict', () => {
  const p = { type: 'consistency_gap', findingIds: ['RM-01'], sectionLabel: 'Room Quality' };
  assert.match(explainPattern(p), /varies significantly/);
  assert.match(explainPattern(p), /rather than a uniformly weak one/);
});

test('18. cross_section_dimension explanation names the dimension and the spread', () => {
  const p = { type: 'cross_section_dimension', findingIds: ['RM-01', 'SAF-01'], sectionIds: ['room', 'safety'], dimension: 'condition' };
  assert.equal(explainPattern(p), 'Condition-related findings appear across 2 areas of the stay.');
});

test('19. no pattern explanation claims causation', () => {
  const graded = setStatus(setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-09'], 'missed'), ['SAF-01'], 'missed');
  const r = report(graded);
  const forbidden = /root cause|causes|caused by|because of|due to/i;
  for (const p of r.patterns) assert.doesNotMatch(p.explanation, forbidden);
});

// ── sections to watch ────────────────────────────────────────────────────

test('20. a Critical finding outranks a lower section score with only Minor findings', () => {
  const graded = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-06'], 'missed');
  const r = report(graded);
  const safety = r.sectionsToWatch.find((s) => s.sectionId === 'safety');
  const room = r.sectionsToWatch.find((s) => s.sectionId === 'room');
  assert.ok(safety && room);
  const safetyRank = r.sectionsToWatch.indexOf(safety);
  const roomRank = r.sectionsToWatch.indexOf(room);
  assert.ok(safetyRank < roomRank, 'the Critical section must rank first, not the lower-scoring Minor one');
});

test('21. a section with a repeated-failure pattern outranks a same-severity section without one', () => {
  // Two Major findings in 'room' (a pattern), one isolated Major in 'facilities'.
  const graded = setStatus(setStatus(setStatus(clean(), ['RM-01'], 'missed'), ['RM-05'], 'missed'), ['FAC-01'], 'missed');
  const r = report(graded);
  const room = r.sectionsToWatch.find((s) => s.sectionId === 'room');
  const facilities = r.sectionsToWatch.find((s) => s.sectionId === 'facilities');
  assert.ok(room && facilities);
  assert.ok(r.sectionsToWatch.indexOf(room) < r.sectionsToWatch.indexOf(facilities));
});

test('22. sections-to-watch ordering is deterministic', () => {
  const graded = setStatus(setStatus(clean(), ['SAF-03'], 'missed'), ['RM-01'], 'missed');
  const a = report(JSON.parse(JSON.stringify(graded)));
  const b = report(JSON.parse(JSON.stringify(graded)));
  assert.deepEqual(a.sectionsToWatch, b.sectionsToWatch);
});

// ── canonical consistency ───────────────────────────────────────────────

test('23. key metrics and performance read the canonical score, never a recomputation', () => {
  const graded = setStatus(clean(), ['RM-01', 'SAF-03'], 'missed');
  const scoreResult = score(graded, FULL_5_STAR);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  const r = buildExecutiveReport({ scoreResult, intelligence });
  assert.equal(r.keyMetrics.overallScore, scoreResult.overall);
  assert.equal(r.keyMetrics.coverage, scoreResult.coverage);
  assert.equal(r.performance.overall, scoreResult.overall);
});

test('24. the report never mutates the score result or the intelligence it was given', () => {
  const graded = setStatus(clean(), ['RM-01', 'SAF-03'], 'missed');
  const scoreResult = score(graded, FULL_5_STAR);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: FULL_5_STAR });
  const beforeScore = JSON.parse(JSON.stringify(scoreResult));
  const beforeIntel = JSON.parse(JSON.stringify(intelligence));
  buildExecutiveReport({ scoreResult, intelligence, certification: certify(scoreResult, { auditType: 'full' }) });
  assert.deepEqual(scoreResult, beforeScore);
  assert.deepEqual(intelligence, beforeIntel);
});

test('25. Not Assessed never appears as a priority, pattern, or section risk', () => {
  const graded = setStatus(clean(), ['RM-06'], 'na', 'day', { naReason: 'not_observed' });
  const r = report(graded);
  assert.equal(r.priorities.some((p) => p.findingIds.includes('RM-06')), false);
  assert.equal(r.sectionsToWatch.some((s) => s.sectionId === 'room'), false);
  assert.equal(r.keyMetrics.urgentIssueCount, 0);
});

test('26. Not Available never appears as a priority, pattern, or section risk', () => {
  const graded = setStatus(clean(), ['RM-10'], 'na', 'day', { naReason: 'not_offered' });
  const r = report(graded);
  assert.equal(r.priorities.some((p) => p.findingIds.includes('RM-10')), false);
  assert.equal(r.sectionsToWatch.some((s) => s.sectionId === 'room'), false);
});

// ── determinism ──────────────────────────────────────────────────────────

test('27. identical input always produces identical output', () => {
  const graded = setStatus(setStatus(clean(), ['RM-01', 'RM-02'], 'missed'), ['SAF-03'], 'missed');
  const a = report(JSON.parse(JSON.stringify(graded)));
  const b = report(JSON.parse(JSON.stringify(graded)));
  assert.deepEqual(a, b);
});

// ── edge / empty states ──────────────────────────────────────────────────

test('an empty audit produces no priorities, patterns, strengths or sections to watch', () => {
  const r = report({});
  assert.deepEqual(r.priorities, []);
  assert.deepEqual(r.patterns, []);
  assert.deepEqual(r.sectionsToWatch, []);
  assert.equal(r.decisionSummary.recommendedFocus, 'insufficient_data');
});

test('a clean-but-incomplete audit recommends maintaining, not addressing', () => {
  const g = { 'SAF-01': { day: { status: 'met' } }, 'SAF-02': { day: { status: 'met' } }, 'SAF-03': { day: { status: 'met' } } };
  const r = report(g);
  assert.equal(r.urgentIssues.length, 0);
  assert.equal(r.decisionSummary.recommendedFocus, 'maintain');
});
