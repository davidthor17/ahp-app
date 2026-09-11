// Phase 7.1 — the published copy, read as a hotel executive would read it.
//
// Phase 7.0 published a real audit and read the report back. The contract held
// and the numbers were right, but the words could be read backwards: a missed
// standard, "No hair, stains, or odors", sat under the heading of a priority as
// though it were a compliment. These tests pin the fixes to what the engine
// actually produces, from that same audit's grades.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublishedResult, publicHeadline, quotedStandard, numberWord,
  validatePublishedResult,
} from '../src/framework/publishedResult.js';
import { analyzeAuditIntelligence } from '../src/framework/auditIntelligence.js';
import { buildExecutiveReport } from '../src/framework/executiveReport.js';
import { score as frameworkScore } from '../src/framework/scoring.js';
import { certify } from '../src/framework/certification.js';
import { buildSnapshot, resolveScoringProfile, SNAPSHOT_STATUS } from '../src/framework/snapshot.js';
import { AUDIT_TYPE } from '../src/framework/weights.js';

const PROP = { name: 'Copy Test', city: 'Test City', country: 'Iceland', category: '4★', hasRestaurant: false, hasPool: false, hasSpa: false };
const CANARY = 'CANARY-7F3 internal auditor note, desk agent on a personal call.';
const g = (status, extra = {}) => ({ morning: { status, ...extra } });

// The exact grades of the Phase 7.0 production audit, AHP-2026-52B25060.
const PHASE_70 = {
  'PRE-01': g('met'), 'PRE-02': g('met'), 'PRE-03': g('met'), 'PRE-04': g('met'), 'PRE-05': g('met'),
  'PRE-08': g('met'), 'PRE-09': g('met'), 'PRE-10': g('met'), 'PRE-11': g('met'), 'PRE-12': g('met'),
  'ARR-01': g('met'), 'ARR-02': g('partial'), 'ARR-03': g('met'), 'ARR-04': g('met'), 'ARR-08': g('met'),
  'ARR-09': g('met'), 'ARR-10': g('met'), 'ARR-11': g('partial'), 'ARR-12': g('met'),
  'REC-01': g('missed', { note: CANARY }), 'REC-02': g('missed'), 'REC-03': g('met'), 'REC-04': g('partial'),
  'REC-08': g('met'), 'REC-09': g('partial'), 'REC-10': g('missed'), 'REC-11': g('met'),
  'RM-01': g('partial'), 'RM-02': g('missed', { critical: true }), 'RM-03': g('met'), 'RM-04': g('met'),
  'RM-05': g('missed'), 'RM-09': g('met'), 'RM-10': g('met'),
  'FAC-01': g('met'), 'FAC-02': g('met'), 'FAC-03': g('met'), 'FAC-04': g('na', { naReason: 'not_observed' }), 'FAC-05': g('met'),
  'SAF-01': g('met'), 'SAF-02': g('met'), 'SAF-03': g('met'),
  'BTH-01': g('met'), 'BTH-02': g('partial'), 'BTH-03': g('met'),
  'HK-01': g('partial'), 'HK-02': g('missed'), 'HK-03': g('met'), 'HK-04': g('met'), 'HK-05': g('met'),
  'DEP-01': g('met'), 'DEP-02': g('met'), 'DEP-03': g('met'), 'DEP-04': g('met'), 'DEP-05': g('met'),
};

function publish(graded = PHASE_70, { auditType = 'full', criticalFailures = [{ itemId: 'RM-02', label: 'No hair, stains, or odors', note: null }] } = {}) {
  const basis = resolveScoringProfile(
    buildSnapshot(PROP, { auditType: AUDIT_TYPE.FULL, lockedAt: '2026-09-11T12:19:39.580Z' }),
    PROP, SNAPSHOT_STATUS.FROZEN,
  );
  const options = { scopeSections: basis.scopeSections, checklistItems: basis.checklistItems };
  const scoreResult = frameworkScore(graded, basis.profile, options);
  const intelligence = analyzeAuditIntelligence({ scoreResult, audit: graded, profile: basis.profile, options });
  const executiveReport = buildExecutiveReport({
    scoreResult, intelligence,
    certification: certify(scoreResult, { auditType, scopeSections: basis.scopeSections }),
  });
  return buildPublishedResult({
    prop: PROP, graded, auditType, criticalFailures, scoringBasis: basis,
    auditedOn: '2026-09-11', publishedAt: '2026-09-11T12:21:40.873Z',
    summary: 'Copy test.', intelligence, executiveReport,
  });
}

const every = (intel) => [
  intel.headline, ...Object.values(intel.summary),
  ...intel.priorities.flatMap((p) => [p.title, p.reason]),
  ...intel.patterns.map((p) => p.explanation),
  ...intel.strengths.flatMap((s) => [s.title, s.reason]),
];

// ── findings read as findings ──────────────────────────────────────────────

test('a missed standard is published as not met, never as the bare standard', () => {
  const intel = publish().intelligence;
  const hygiene = intel.priorities.find((p) => p.title.includes('No hair, stains, or odors'));
  assert.equal(hygiene.title, 'Standard not met: “No hair, stains, or odors”');
  for (const p of intel.priorities) {
    assert.match(p.title, /^(Standard not met: “|Standard partly met: “|[A-Z][a-z]+ standards not fully met in |A standard was not fully met in )/,
      `"${p.title}" must lead with the outcome`);
  }
});

test('a partly met standard says partly, not not met', () => {
  // An audit whose only finding is one partial, so it cannot fall outside the
  // top-five cap the way an isolated minor partial does on the full 7.0 audit.
  const clean = Object.fromEntries(Object.keys(PHASE_70).map((id) => [id, PHASE_70[id].morning.status === 'na' ? PHASE_70[id] : g('met')]));
  const intel = publish({ ...clean, 'BTH-02': g('partial') }, { criticalFailures: [] }).intelligence;
  assert.equal(intel.priorities.length, 1);
  assert.equal(intel.priorities[0].title, 'Standard partly met: “Strong water pressure, stable temperature”');
  assert.equal(/not met/.test(intel.priorities[0].title), false);
});

test('a standard that was met never appears as a priority at all', () => {
  const intel = publish().intelligence;
  const flat = intel.priorities.map((p) => p.title + p.reason).join(' ');
  for (const met of ['Guest greeted within 30 seconds'.replace('Guest greeted within 30 seconds', 'Luggage assistance offered proactively'), 'Billing accurate and clearly itemized']) {
    assert.equal(flat.includes(met), false, `${met} was met and must not be listed`);
  }
});

test('a priority title and its reason never say the same thing twice', () => {
  const intel = publish().intelligence;
  for (const p of intel.priorities) {
    assert.notEqual(p.title, p.reason);
    assert.equal(/priority/i.test(p.title), false, `"${p.title}" repeats the severity label the page already prints`);
    assert.equal(/priority/i.test(p.reason), false, `"${p.reason}" repeats the severity label`);
    const quoted = (p.title.match(/“[^”]+”/) || [])[0];
    if (quoted) assert.equal(p.reason.includes(quoted), false, 'a single finding does not quote its standard twice');
    assert.match(p.reason, /shortfall against the standard\.$/, 'the reason says how serious, in words');
  }
});

test('a grouped priority names the standards it groups, rather than counting them', () => {
  const intel = publish().intelligence;
  const group = intel.priorities.find((p) => p.findingCount > 1);
  assert.ok(group, 'the Phase 7.0 audit has a grouped priority');
  assert.match(group.title, /^[A-Z][a-z]+ standards not fully met in /, 'the count is written as a word');
  assert.ok((group.reason.match(/“/g) || []).length >= 2, 'and the reason names what they were');
});

test('no published sentence carries an em dash, even when the catalogue label does', () => {
  // PRE-09 is "Website quality — design, content, ease of use".
  assert.equal(quotedStandard('Website quality — design, content, ease of use'), '“Website quality: design, content, ease of use”');
  const graded = { ...PHASE_70, 'PRE-09': g('missed') };
  for (const s of every(publish(graded).intelligence)) {
    assert.equal(/—|–|--/.test(s), false, `"${s}" carries a forbidden dash`);
  }
});

test('no auditor note and no item id reaches the published copy', () => {
  const flat = JSON.stringify(publish().intelligence);
  assert.equal(flat.includes('CANARY'), false);
  assert.equal(/\b[A-Z]{2,4}-\d{2}\b/.test(flat), false, 'no catalogue item id anywhere in the block');
});

// ── strengths, patterns, headline ──────────────────────────────────────────

test('strengths are titled by their section and never read as one sentence three times', () => {
  const { strengths } = publish().intelligence;
  assert.deepEqual(strengths.map((s) => s.title), ['Pre-Arrival & Website', 'Departure', 'Facilities']);
  assert.equal(new Set(strengths.map((s) => s.reason.replace(/\d+/g, 'N'))).size, strengths.length, 'three different sentences');
  for (const s of strengths) {
    assert.ok(s.reason.includes(String(s.assessedCount)), 'each states the count it rests on');
    assert.equal(/consistently strong performance/i.test(s.title), false);
  }
});

test('a cross-area pattern names its areas, in client words', () => {
  const cross = publish().intelligence.patterns.find((p) => p.type === 'cross_area');
  assert.ok(cross);
  assert.equal(cross.explanation, 'Findings about the physical condition of the property were recorded in Arrival & Entrance, Room Quality, Bathroom and Housekeeping.');
  assert.equal(/condition-related/i.test(cross.explanation), false);
});

test('the Phase 7.0 headline now says the standard was not met', () => {
  const { intelligence, standardMet, score } = publish();
  assert.equal(standardMet, false);
  assert.equal(score.percent, 76);
  assert.equal(intelligence.headline, 'Good overall performance but below the Specula standard, with one high-priority issue requiring resolution.');
});

test('the below-standard clause appears only where the band would otherwise sound like a pass', () => {
  const h = (o) => publicHeadline({ hasPriorities: true, ...o });
  assert.match(h({ percent: 92, standardMet: false, auditType: 'full' }), /^Strong overall performance but below the Specula standard\.$/);
  assert.match(h({ percent: 80, standardMet: false, auditType: 'spot' }), /but below the Specula standard/);
  assert.equal(/below/.test(h({ percent: 80, standardMet: false, auditType: 'desk' })), false, 'a Desk Review issues no status');
  assert.equal(/below/.test(h({ percent: 60, standardMet: false, auditType: 'full' })), false, 'Mixed already says it');
  assert.equal(/below/.test(h({ percent: 92, standardMet: true, auditType: 'full' })), false);
  assert.equal(/below/.test(h({ percent: 92 })), false, 'callers that pass no status keep the old sentence');
  assert.equal(publicHeadline({ percent: 96, standardMet: false, auditType: 'full' }), 'Strong overall performance but below the Specula standard.',
    'never "consistently strong" for an audit that missed the standard');
  assert.equal(numberWord(1), 'one');
  assert.equal(numberWord(12), '12');
});

test('the copy changes nothing about the contract or its determinism', () => {
  const a = publish();
  assert.deepEqual(validatePublishedResult(a), []);
  assert.equal(JSON.stringify(a), JSON.stringify(publish()));
  assert.deepEqual(Object.keys(a.intelligence.priorities[0]).sort(),
    ['affectedSections', 'findingCount', 'rank', 'reason', 'sectionIds', 'severity', 'title']);
});
