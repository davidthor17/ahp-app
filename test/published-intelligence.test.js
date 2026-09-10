// Phase 6.8 — the published intelligence contract.
//
// The payload is the whole guarantee, and version 2 widens it for the first
// time since it was written. So these tests care about three things, in this
// order of importance.
//
//   What must never cross the line. Auditor notes, evidence, the internal
//   severity ladder, weight classes, the decision summary, coverage. Not "is
//   absent from the shape we built" but "does not appear anywhere in the
//   serialised document", because a leak that arrives by nesting is still a
//   leak.
//
//   That the block is exactly the allow-list. Key by key, at every level. An
//   allow-list nobody checks is a spread with extra steps.
//
//   That a version 1 document is untouched by any of it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublishedResult, buildPublishedIntelligence,
  validatePublishedResult, validatePublishedIntelligence, isValidPublishedResult,
  PUBLISHED_RESULT_VERSION, SUPPORTED_PUBLISHED_RESULT_VERSIONS,
  PUBLIC_SEVERITY, PUBLIC_PATTERN_TYPE, INTELLIGENCE_LIMITS,
  publicBand, publicHeadline,
} from '../src/framework/publishedResult.js';
import { analyzeAuditIntelligence } from '../src/framework/auditIntelligence.js';
import { buildExecutiveReport } from '../src/framework/executiveReport.js';
import { score as frameworkScore } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { buildSnapshot, resolveScoringProfile, SNAPSHOT_STATUS } from '../src/framework/snapshot.js';
import { SEVERITY, AUDIT_TYPE } from '../src/framework/weights.js';

const PROP = {
  name: 'Hotel Borealis', city: 'Reykjavik', country: 'Iceland', category: '5★',
  hasRestaurant: true, hasPool: true, hasSpa: true,
};

const PUBLISHED_AT = '2026-09-14T10:22:41.108Z';
const AUDITED_ON = '2026-09-12';

// The note is the thing this phase exists to keep out of the public document.
// Distinctive enough that a substring search cannot miss it wherever it lands.
const PRIVATE_NOTE = 'INTERNAL_AUDITOR_NOTE_MUST_NEVER_BE_PUBLISHED';

const g = (status, note) => ({ day: note ? { status, note } : { status } });

/**
 * A real audit, scored by the real engine.
 *
 * Deliberately not hand-built fixtures for findings and priorities: the point
 * of the contract is what happens to what the engine actually produces, and a
 * fixture cannot leak a field the engine adds next month.
 */
function realAudit(graded) {
  const basis = resolveScoringProfile(
    buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL, lockedAt: '2026-09-12T08:14:00.000Z' }),
    PROP, SNAPSHOT_STATUS.FROZEN,
  );
  const options = { scopeSections: basis.scopeSections, checklistItems: basis.checklistItems };
  const scoreResult = frameworkScore(graded, basis.profile, options);
  const intelligence = analyzeAuditIntelligence({
    scoreResult, audit: graded, profile: basis.profile, options,
  });
  const executiveReport = buildExecutiveReport({
    scoreResult, intelligence,
    certification: certify(scoreResult, { auditType: AUDIT_TYPE.FULL, scopeSections: basis.scopeSections }),
  });
  return { basis, scoreResult, intelligence, executiveReport };
}

// A messy but ordinary audit: several sections, findings of more than one
// severity, more than one finding in a section, and notes on every finding.
const MESSY = {
  'RM-01': g('met'), 'RM-02': g('missed', PRIVATE_NOTE), 'RM-03': g('missed', PRIVATE_NOTE),
  'RM-04': g('met'), 'RM-05': g('partial', PRIVATE_NOTE), 'RM-06': g('met'), 'RM-07': g('met'),
  'PRE-01': g('met'), 'PRE-02': g('met'), 'PRE-03': g('met'), 'PRE-04': g('met'),
  'SAF-01': g('missed', PRIVATE_NOTE), 'SAF-02': g('met'), 'SAF-03': g('met'),
  'ARR-01': g('missed', PRIVATE_NOTE), 'ARR-02': g('met'), 'ARR-03': g('met'),
  'BATH-01': g('partial', PRIVATE_NOTE), 'BATH-02': g('met'),
};

function publish(graded = MESSY, over = {}) {
  const { basis, intelligence, executiveReport } = realAudit(graded);
  return buildPublishedResult({
    prop: PROP, graded, auditType: 'full',
    criticalFailures: [], scoringBasis: basis,
    auditedOn: AUDITED_ON, publishedAt: PUBLISHED_AT,
    summary: 'A calm house with a few things to put right.',
    intelligence, executiveReport,
    ...over,
  });
}

// ── A. version 1 compatibility ─────────────────────────────────────────────

test('a payload built without intelligence inputs carries no intelligence key', () => {
  const payload = publish(MESSY, { intelligence: null, executiveReport: null });
  assert.equal('intelligence' in payload, false, 'absent, not null');
  assert.equal(isValidPublishedResult(payload), true);
});

test('either input missing on its own is still no intelligence at all', () => {
  const { intelligence, executiveReport } = realAudit(MESSY);
  assert.equal(buildPublishedIntelligence({ intelligence, executiveReport: null }), null);
  assert.equal(buildPublishedIntelligence({ intelligence: null, executiveReport }), null);
  assert.equal(buildPublishedIntelligence({}), null);
});

test('a version 1 document stays valid forever and may never grow a block', () => {
  const v1 = publish(MESSY, { intelligence: null, executiveReport: null });
  v1.formatVersion = 1;
  assert.deepEqual(validatePublishedResult(v1), [], 'every report published before Phase 6.8');

  const hybrid = { ...v1, intelligence: publish().intelligence };
  assert.ok(
    validatePublishedResult(hybrid).some((e) => e.includes('formatVersion 1 carries no intelligence')),
    'a version 1 document with a block is not a version 1 document',
  );
});

// ── B. a valid version 2 payload ───────────────────────────────────────────

test('the builder emits version 2 and the reader supports both', () => {
  assert.equal(PUBLISHED_RESULT_VERSION, 2);
  assert.deepEqual([...SUPPORTED_PUBLISHED_RESULT_VERSIONS], [1, 2]);
  assert.equal(publish().formatVersion, 2);
});

test('a version 2 payload validates, block and all', () => {
  const payload = publish();
  assert.deepEqual(validatePublishedResult(payload), []);
  assert.deepEqual(validatePublishedIntelligence(payload.intelligence), []);
});

test('the block says what the audit actually found', () => {
  const { executiveReport } = realAudit(MESSY);
  const intel = publish().intelligence;

  assert.ok(intel.headline, 'a headline is always present');
  assert.equal(intel.summary.overallPerformance, executiveReport.executiveSummary.overallPerformance);

  assert.ok(intel.priorities.length > 0, 'this audit has findings, so it has priorities');
  assert.equal(intel.priorities[0].rank, 1, 'the upstream ranking is carried, not redone');
  assert.deepEqual(
    intel.priorities.map((p) => p.rank),
    executiveReport.priorities.slice(0, INTELLIGENCE_LIMITS.priorities).map((p) => p.rank),
    'same priorities in the same order',
  );
  assert.equal(intel.summary.primaryConcern, intel.priorities[0].title, 'the concern is the published title');

  // The framework's weighted score is deliberately not published: the document
  // already prints the unweighted legacy figure, and two percentages on one page
  // is a contradiction rather than a detail.
  assert.equal('overallScore' in intel.keyMetrics, false);
  assert.equal(intel.summary.overallPerformance, 'Mixed', 'banded on the published score, not the framework one');
  assert.equal(intel.keyMetrics.urgentIssueCount, executiveReport.urgentIssues.length);
  assert.equal(intel.urgentIssueCount + intel.improvementCount, intel.priorities.length,
    'every published priority is one or the other, and never both');
});

test('every list is capped at what the contract promises', () => {
  // Enough findings, spread widely enough, to overrun every cap at once.
  const wide = {};
  for (const [prefix, n] of [['RM', 8], ['PRE', 6], ['ARR', 4], ['SAF', 3], ['BATH', 4], ['HK', 4], ['DEP', 4]]) {
    for (let i = 1; i <= n; i++) wide[`${prefix}-0${i}`] = g(i % 2 ? 'missed' : 'partial', PRIVATE_NOTE);
  }
  const intel = publish(wide).intelligence;
  assert.ok(intel.priorities.length <= INTELLIGENCE_LIMITS.priorities);
  assert.ok(intel.patterns.length <= INTELLIGENCE_LIMITS.patterns);
  assert.ok(intel.strengths.length <= INTELLIGENCE_LIMITS.strengths);
  assert.ok(intel.sectionsToWatch.length <= INTELLIGENCE_LIMITS.sectionsToWatch);
  assert.deepEqual(validatePublishedResult(publish(wide)), []);
});

test('a clean audit publishes strengths and no concern rather than an invented one', () => {
  const clean = {
    'RM-01': g('met'), 'RM-02': g('met'), 'RM-03': g('met'), 'RM-04': g('met'),
    'PRE-01': g('met'), 'PRE-02': g('met'), 'PRE-03': g('met'),
  };
  const intel = publish(clean).intelligence;
  assert.equal(intel.priorities.length, 0);
  assert.equal(intel.patterns.length, 0);
  assert.equal('primaryConcern' in intel.summary, false, 'no finding, so no concern line');
  assert.equal('operationalPattern' in intel.summary, false);
  assert.ok(intel.strengths.length > 0);
  assert.equal(intel.summary.positiveSignal, intel.strengths[0].title);
  assert.deepEqual(validatePublishedIntelligence(intel), []);
});

test('an audit with nothing graded still produces a renderable document', () => {
  const intel = publish({}).intelligence;
  assert.match(intel.headline, /not yet been scored/);
  assert.equal(intel.summary.overallPerformance, 'Not yet scored');
  assert.equal(intel.priorities.length, 0);
  assert.deepEqual(validatePublishedResult(publish({})), []);
});

// ── E / F. the allow-list, and what must never cross it ────────────────────

test('the block is exactly the allow-list, at every level', () => {
  const intel = publish().intelligence;

  assert.deepEqual(Object.keys(intel).sort(), [
    'headline', 'improvementCount', 'keyMetrics', 'patterns', 'priorities',
    'sectionsToWatch', 'strengths', 'summary', 'urgentIssueCount',
  ]);

  assert.deepEqual(Object.keys(intel.keyMetrics).sort(), [
    'notAssessedCount', 'notAvailableCount', 'patternCount',
    'priorityCount', 'strengthCount', 'urgentIssueCount',
  ]);

  // summary lines appear only when their fact does, so the keys are a subset.
  for (const k of Object.keys(intel.summary)) {
    assert.ok(
      ['overallPerformance', 'primaryConcern', 'operationalPattern', 'positiveSignal'].includes(k),
      `summary.${k} is not in the allow-list`,
    );
  }

  for (const p of intel.priorities) {
    assert.deepEqual(Object.keys(p).sort(), [
      'affectedSections', 'findingCount', 'rank', 'reason', 'sectionIds', 'severity', 'title',
    ]);
  }
  for (const p of intel.patterns) {
    assert.deepEqual(Object.keys(p).sort(), ['explanation', 'sectionIds', 'severity', 'type']);
  }
  for (const s of intel.strengths) {
    assert.deepEqual(Object.keys(s).sort(), ['assessedCount', 'reason', 'sectionId', 'title']);
  }
  for (const s of intel.sectionsToWatch) {
    assert.deepEqual(Object.keys(s).sort(), ['findingCount', 'sectionId', 'sectionLabel', 'severity']);
  }
});

test('no auditor note reaches the public document, however deeply nested', () => {
  // Every finding in this audit carries the note, and upstream interpolates it
  // straight into priorities[].reason. A flat search over the whole serialised
  // document is the only check that cannot be fooled by a new nesting level.
  const flat = JSON.stringify(publish());
  assert.equal(flat.includes(PRIVATE_NOTE), false, 'the note is nowhere in the payload');

  // And prove the note really was there to leak, so this test cannot pass by
  // accident on an audit that never had one.
  const { executiveReport } = realAudit(MESSY);
  assert.ok(
    JSON.stringify(executiveReport).includes(PRIVATE_NOTE),
    'the upstream report does carry the note, which is exactly why the allow-list exists',
  );
});

test('no internal machinery reaches the public document', () => {
  const flat = JSON.stringify(publish()).toLowerCase();
  for (const leak of [
    'zero_tolerance', 'weightclass', 'foundation', 'distinction',
    'defaultseverity', 'derivedseverity', 'escalated', 'evidence',
    'decisionsummary', 'recommendedfocus', 'findingids', 'relatedpatternids',
    'repeated_failure', 'consistency_gap', 'cross_section_dimension',
    'coverage', 'certif', 'frameworkversion', 'checklistversion',
    'scopesections', 'auditor_id', 'opportunit', 'photo',
  ]) {
    assert.equal(flat.includes(leak), false, `${leak} must not reach the public payload`);
  }
});

test('every internal severity and pattern type has a public word for it', () => {
  // If the framework grows a fifth severity or a fourth pattern type, this
  // fails here rather than silently publishing the internal identifier.
  for (const s of Object.values(SEVERITY)) {
    assert.ok(PUBLIC_SEVERITY[s], `${s} has no public severity`);
  }
  for (const t of ['repeated_failure', 'consistency_gap', 'cross_section_dimension']) {
    assert.ok(PUBLIC_PATTERN_TYPE[t], `${t} has no public pattern type`);
  }
  // An escalation is published as a critical issue, not as evidence that an
  // escalation tier exists.
  assert.equal(PUBLIC_SEVERITY[SEVERITY.ZERO_TOLERANCE], 'high');
});

test('an escalated finding publishes as critical and takes its note with it nowhere', () => {
  const escalated = {
    ...MESSY,
    'SAF-01': { day: { status: 'missed', note: PRIVATE_NOTE, critical: true } },
  };
  const intel = publish(escalated).intelligence;
  for (const p of intel.priorities) {
    assert.ok(['high', 'moderate', 'low'].includes(p.severity), `${p.severity} is not public vocabulary`);
  }
  assert.equal(JSON.stringify(intel).includes(PRIVATE_NOTE), false);
});

// ── G. deterministic generation ────────────────────────────────────────────

test('the same audit publishes a byte-identical document, twice', () => {
  assert.equal(JSON.stringify(publish()), JSON.stringify(publish()));
});

test('key order is stable, so byte-identical means byte-identical', () => {
  const a = JSON.stringify(publish(MESSY));
  const b = JSON.stringify(publish({ ...MESSY }));
  assert.equal(a, b, 'a differently-built but equal input serialises identically');
});

// ── J / K. immutability, at the level this repository can prove it ─────────
//
// The publish-once condition itself is a Supabase filter and is proved against
// the real database during rollout. What is provable here is the half that
// matters for the payload: that a document, once built, is a value and not a
// view, so nothing that happens afterwards can move it.

test('a later mutation of the audit cannot alter an already-built document', () => {
  const graded = { ...MESSY };
  const payload = publish(graded);
  const frozen = JSON.stringify(payload);

  // The audit goes on being edited after publication, which is exactly what
  // audit_items allows: more findings, worse statuses, new notes.
  graded['RM-06'] = g('missed', PRIVATE_NOTE);
  graded['RM-07'] = g('missed', PRIVATE_NOTE);
  graded['HK-01'] = g('missed', PRIVATE_NOTE);

  assert.equal(JSON.stringify(payload), frozen, 'the published document did not move');

  const republished = publish(graded);
  assert.notEqual(
    JSON.stringify(republished), frozen,
    'and the mutation is real: rebuilding now would produce a different document, '
    + 'which is precisely what the publish-once condition prevents from ever being written',
  );
});

test('a later change to the property cannot alter an already-built document', () => {
  const payload = publish();
  const frozen = JSON.stringify(payload);
  PROP.name = 'Renamed Hotel';
  try {
    assert.equal(JSON.stringify(payload), frozen);
  } finally {
    PROP.name = 'Hotel Borealis';
  }
});

// ── validation ─────────────────────────────────────────────────────────────

test('validation rejects an intelligence block a reader could not trust', () => {
  const good = publish().intelligence;
  const cases = [
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
    ['no headline', { ...good, headline: '' }],
    ['no summary', { ...good, summary: undefined }],
    ['no keyMetrics', { ...good, keyMetrics: undefined }],
    ['coverage smuggled into keyMetrics', { ...good, keyMetrics: { ...good.keyMetrics, coverage: 91 } }],
    ['a non-numeric metric', { ...good, keyMetrics: { ...good.keyMetrics, priorityCount: 'four' } }],
    ['priorities not an array', { ...good, priorities: {} }],
    ['too many priorities', { ...good, priorities: Array.from({ length: 6 }, () => good.priorities[0]) }],
    ['an internal severity', { ...good, priorities: [{ ...good.priorities[0], severity: 'zero_tolerance' }] }],
    ['an internal pattern type', { ...good, patterns: [{ ...good.patterns[0], type: 'repeated_failure' }] }],
    ['a strength carrying its weighted score', {
      ...good, strengths: [{ sectionId: 'room', title: 't', reason: 'r', assessedCount: 3, score: 88 }],
    }],
    ['no counts', { ...good, urgentIssueCount: undefined }],
  ];
  for (const [label, intel] of cases) {
    assert.ok(validatePublishedIntelligence(intel).length > 0, `${label} must be rejected`);
    assert.ok(
      validatePublishedResult({ ...publish(), intelligence: intel }).length > 0,
      `${label} must be rejected through the payload too`,
    );
  }
});

test('validation reports every problem in the block, not just the first', () => {
  const errors = validatePublishedIntelligence({ headline: '', keyMetrics: {}, priorities: 'no' });
  assert.ok(errors.length >= 4, `expected several errors, got ${errors.length}`);
  assert.ok(errors.some((e) => e.includes('headline')));
  assert.ok(errors.some((e) => e.includes('priorities')));
});

// ── the published headline ─────────────────────────────────────────────────
//
// Built here rather than carried over from executiveReport, because that one is
// banded on the framework's weighted score and this document publishes the
// unweighted one. A headline banded on a number the page does not print would
// sit directly above a figure that disagrees with it.

test('the headline is banded on the score the document actually publishes', () => {
  assert.equal(publicBand(96), 'strong');
  assert.equal(publicBand(90), 'strong');
  assert.equal(publicBand(75), 'good');
  assert.equal(publicBand(50), 'mixed');
  assert.equal(publicBand(49), 'attention');
  assert.equal(publicBand(null), null);
});

test('the headline says what is there, and never the word critical', () => {
  const cases = [
    [{ percent: null }, /not yet been scored/],
    [{ percent: 96 }, /consistently strong guest experience/],
    [{ percent: 92, highCount: 1, hasPriorities: true }, /1 high priority issue to address/],
    [{ percent: 92, highCount: 3, hasPriorities: true }, /3 high priority issues to address/],
    [{ percent: 80, hasPattern: true, hasPriorities: true }, /recurring pattern across the stay/],
    [{ percent: 60, hasPriorities: true }, /^Mixed overall performance\.$/],
    [{ percent: 30, hasPriorities: true }, /^Overall performance requires attention\.$/],
  ];
  for (const [input, shape] of cases) {
    const line = publicHeadline(input);
    assert.match(line, shape);
    assert.equal(/critical/i.test(line), false, `"${line}" must not use the word critical`);
    assert.equal(/—|--/.test(line), false, `"${line}" uses a forbidden dash`);
  }
});

test('no published copy uses the word critical or a forbidden dash', () => {
  // The report reserves "critical" for a failure the auditor flagged by hand,
  // under its own heading. A framework severity appearing under the same word
  // would let one page say "no critical findings recorded" above a list of them.
  const intel = publish().intelligence;
  const strings = [
    intel.headline,
    ...Object.values(intel.summary),
    ...intel.priorities.flatMap((p) => [p.title, p.reason]),
    ...intel.patterns.map((p) => p.explanation),
    ...intel.strengths.flatMap((s) => [s.title, s.reason]),
  ];
  for (const s of strings) {
    assert.equal(/critical/i.test(s), false, `"${s}" uses the word critical`);
    assert.equal(/—|--/.test(s), false, `"${s}" uses an em dash or double dash`);
  }
});
