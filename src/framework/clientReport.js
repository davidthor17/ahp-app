// Phase 6.7 — Premium Client Report contract.
//
// This is a reduction, not a new engine. Every number and every ranked list
// here was already computed — score() gives the scores, deriveFinding()
// gives the findings, auditIntelligence.js gives the priorities/patterns/
// strengths, executiveReport.js gives the headline and the urgent/
// improvement split, certify() gives the certification level. This module
// contributes exactly three things none of those already do:
//
//   1. a client-safe shape (no raw Supabase rows, no internal-only fields)
//   2. evidence attached to the findings that carry it
//   3. a draft/published gate, because a client report must never be
//      built from an audit nobody has published yet
//
//   score() -> deriveFinding() -> auditIntelligence -> executiveReport ->
//   (this module) -> a future secure client delivery surface
//
// Pure, deterministic, side-effect free, independent of React and of
// Supabase. Evidence is passed in as already-loaded photo state (the same
// shape App.jsx already holds) — this module never fetches a signed URL or
// touches the network; resolving a photo to a viewable URL is a UI-layer
// concern with its own async lifecycle, kept out of a pure module on
// purpose.

import { PHOTO_STATUS } from './photoEvidence.js';
import { CATALOG_SECTIONS } from './catalog.js';

const AUDIT_TYPE_LABEL = Object.freeze({ desk: 'Desk Review', spot: 'Spot Audit', full: 'Full Audit' });

// The canonical id -> label map, so a section with zero findings (nothing
// to derive a label from) still gets its real name rather than its raw id.
// In catalogue order, which is also the order section rows are shown in.
const SECTION_LABEL = new Map(CATALOG_SECTIONS.map((s) => [s.id, s.label]));
const SECTION_POSITION = new Map(CATALOG_SECTIONS.map((s, i) => [s.id, i]));

// ── evidence ────────────────────────────────────────────────────────────

/**
 * Evidence, indexed by the item it was taken against.
 *
 * Only photos the server has actually confirmed (PHOTO_STATUS.SAVED, with
 * a remote id) ever become evidence — a photo still uploading or one that
 * failed is not evidence yet, the same rule the in-app photo count already
 * follows. `photos` is keyed by `photoKey(itemId, shiftId)`; the itemId is
 * recovered by splitting on the first space, since no catalogue item id
 * contains one.
 */
function buildEvidence(photos = {}) {
  const byItemId = {};
  let totalCount = 0;
  for (const [key, list] of Object.entries(photos)) {
    const itemId = key.split(' ')[0];
    for (const p of list || []) {
      if (p.status !== PHOTO_STATUS.SAVED || !p.remote || !p.remote.id) continue;
      if (!byItemId[itemId]) byItemId[itemId] = [];
      byItemId[itemId].push({
        photoId: p.remote.id,
        storagePath: p.remote.storagePath || null,
        caption: p.note || null,
        createdAt: p.remote.createdAt || null,
      });
      totalCount += 1;
    }
  }
  return { byItemId, totalCount };
}

const evidenceCountFor = (evidence, itemIds) =>
  itemIds.reduce((n, id) => n + ((evidence.byItemId[id] || []).length), 0);

// ── metadata ────────────────────────────────────────────────────────────

function buildMetadata({ property, auditMeta, certification }) {
  const isDesk = certification && certification.auditType === 'desk';
  return {
    propertyName: property.name || null,
    city: property.city || null,
    country: property.country || null,
    category: property.category || null,
    auditType: auditMeta.auditType || null,
    auditTypeLabel: AUDIT_TYPE_LABEL[auditMeta.auditType] || auditMeta.auditType || null,
    auditedOn: auditMeta.auditedOn || null,
    publishedAt: auditMeta.publishedAt || null,
    // The identifier the audit already carries (genRef(), e.g. "AHP-2026-D699"),
    // never a second one minted here.
    reportId: auditMeta.auditRef || null,
    status: auditMeta.status || 'draft',
    certificationLabel: !isDesk && certification && certification.eligible ? certification.label : null,
  };
}

// ── certification, in client-safe language ────────────────────────────

/**
 * One paragraph, never punitive. certification.js decides eligibility;
 * this only chooses which honest sentence describes the outcome — it
 * never invents a reason certify() did not already give.
 */
function buildCertificationSection(certification) {
  if (!certification) return null;
  const { auditType, eligible, label, ceilingLabel } = certification;

  if (auditType === 'desk') {
    return {
      level: null, label: null, eligible: false,
      statement: 'This was a Desk Review. Desk Reviews confirm that an assessment took place and do not carry a Specula certification level.',
    };
  }
  if (eligible) {
    return {
      level: certification.level, label, eligible: true,
      statement: `This property meets Specula's requirements for ${label}.`,
    };
  }
  return {
    level: null, label: null, eligible: false,
    statement: ceilingLabel
      ? `This audit did not meet the requirements for Specula certification at this time. The highest level available to this audit is ${ceilingLabel}.`
      : 'This audit did not meet the requirements for Specula certification at this time.',
  };
}

// ── methodology ─────────────────────────────────────────────────────────

function buildMethodology(auditType) {
  const blocks = [
    {
      title: 'Assessment basis',
      text: `This report reflects a ${AUDIT_TYPE_LABEL[auditType] || 'Specula'} carried out against Specula's defined audit checklist.`,
    },
    {
      title: 'Score and coverage',
      text: 'Overall score reflects the quality of what was assessed. Coverage reflects how much of the applicable checklist was actually assessed on this stay. A high score always describes quality, never completeness — both figures are reported together for that reason.',
    },
    {
      title: 'Not Assessed and Not Available',
      text: 'An item marked Not Assessed was not experienced on this stay and never counts against the score, though it is reflected in coverage. An item marked Not Available does not apply to this property and is excluded from the assessment entirely. Neither is a finding against the property.',
    },
  ];
  if (auditType !== 'desk') {
    blocks.push({
      title: 'Certification',
      text: 'Specula certification requires a minimum score, minimum coverage, and the absence of any Critical or Zero Tolerance finding. It is awarded only when every requirement is met.',
    });
  }
  return blocks;
}

// ── entry point ───────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {object} input.scoreResult     score()'s return value
 * @param {object} input.intelligence    analyzeAuditIntelligence()'s return value
 * @param {object} input.executiveReport buildExecutiveReport()'s return value — reused, not recomputed
 * @param {object} input.certification   certify()'s return value
 * @param {object} input.property        { name, city, country, category }
 * @param {object} input.auditMeta       { auditRef, auditType, auditedOn, publishedAt, status }
 *   status must be 'draft' or 'published' — the caller's own honest record
 *   of whether this audit has actually been published, never inferred here.
 * @param {object} [input.photos]        the console's photo state, keyed by photoKey(itemId, shiftId)
 */
export function buildClientReport({
  scoreResult, intelligence, executiveReport, certification,
  property = {}, auditMeta = {}, photos = {},
} = {}) {
  const findings = (intelligence && intelligence.findings) || [];
  const evidence = buildEvidence(photos);

  const detailedFindings = findings.map((f) => ({
    itemId: f.itemId,
    label: f.label,
    sectionId: f.sectionId,
    sectionLabel: f.sectionLabel,
    severity: f.severity,
    status: f.status,
    note: f.note || null,
    escalated: f.escalated,
    evidenceCount: evidenceCountFor(evidence, [f.itemId]),
  }));

  const priorities = ((executiveReport && executiveReport.priorities) || []).map((p) => ({
    ...p,
    evidenceCount: evidenceCountFor(evidence, p.findingIds),
  }));
  const urgentIssues = ((executiveReport && executiveReport.urgentIssues) || []).map((p) => ({
    ...p,
    evidenceCount: evidenceCountFor(evidence, p.findingIds),
  }));
  const improvementAreas = ((executiveReport && executiveReport.improvementAreas) || []).map((p) => ({
    ...p,
    evidenceCount: evidenceCountFor(evidence, p.findingIds),
  }));
  const patterns = ((executiveReport && executiveReport.patterns) || []).map((p) => ({
    ...p,
    evidenceCount: evidenceCountFor(evidence, p.findingIds),
  }));

  const sections = scoreResult && scoreResult.bySection
    ? Object.entries(scoreResult.bySection)
      .filter(([, s]) => s.score !== null)
      .map(([sectionId, s]) => ({
        sectionId,
        // The catalogue's own label, not derived from whether this section
        // happens to have a finding — a section with nothing wrong in it
        // still has a real name to show next to its score.
        sectionLabel: SECTION_LABEL.get(sectionId) || sectionId,
        score: s.score,
      }))
      .sort((a, b) => (SECTION_POSITION.get(a.sectionId) ?? 999) - (SECTION_POSITION.get(b.sectionId) ?? 999))
    : [];

  const status = auditMeta.status === 'published' ? 'published' : 'draft';

  return {
    // A client report is only ever built from a published audit. This
    // module still returns a full model for a draft one, because the
    // console needs to preview it before publishing — but `clientReady`
    // is the one field a delivery surface must check before it will ever
    // show this to an actual client, and it is never true for a draft.
    clientReady: status === 'published',

    metadata: buildMetadata({ property, auditMeta, certification }),

    executiveOverview: {
      headline: executiveReport ? executiveReport.headline : null,
      summary: executiveReport ? executiveReport.executiveSummary : null,
      overallScore: scoreResult ? scoreResult.overall : null,
      coverage: scoreResult ? scoreResult.coverage : null,
      priorityCount: priorities.length,
      urgentCount: urgentIssues.length,
      strengthCount: ((executiveReport && executiveReport.strengths) || []).length,
    },

    performance: {
      overallScore: scoreResult ? scoreResult.overall : null,
      coverage: scoreResult ? scoreResult.coverage : null,
      sections,
    },

    priorities,
    urgentIssues,
    improvementAreas,
    patterns,
    strengths: (executiveReport && executiveReport.strengths) || [],

    findings: detailedFindings,
    evidence,

    certification: buildCertificationSection(certification),
    methodology: buildMethodology(auditMeta.auditType),
  };
}
