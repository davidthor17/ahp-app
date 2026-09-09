// Phase 6.1 — who may write to which audit, and the database agreeing.
//
// The mismatch this closes cost a real audit. "internal reads all audits" lets
// any auditor open anybody's audit; only "internal manages own audit items"
// governs writing. Resuming somebody else's audit therefore gave a fully
// working capture screen in which every write came back 42501 forever, with
// twenty-two grades stranded on the device.
//
// The fix has two halves and both are asserted here in the shape the database
// states them:
//
//   owner    manages every audit          "owner manages all *"
//   auditor  manages the audits it owns   "internal manages own *"
//   reviewer manages nothing              no ALL policy exists for it
//
// Nothing in this module grants anything. If it and the policies disagree the
// database wins, so every rule below has a named policy behind it and the
// tests say which.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLE, INTERNAL_ROLES,
  isAdminRole, isInternalRole, isReviewerRole, canBrowseAudits,
  canEditAudit, canResumeAudit, canViewAudit, resumeRefusal,
} from '../src/framework/authorization.js';

const ADMIN    = 'aaaaaaaa-0000-0000-0000-000000000001';   // davidthor, owner
const AUDITOR  = 'bbbbbbbb-0000-0000-0000-000000000002';   // an ordinary auditor
const OTHER    = 'cccccccc-0000-0000-0000-000000000003';   // somebody else
const REVIEWER = 'dddddddd-0000-0000-0000-000000000004';

const ownedBy = (id) => ({ id: 'audit-1', ref: 'AHP-2026-TEST', auditor_id: id });

const MINE     = ownedBy(AUDITOR);
const THEIRS   = ownedBy(OTHER);
const ORPHANED = { id: 'audit-2', ref: 'AHP-2026-NULL', auditor_id: null };

// ── the roles themselves ────────────────────────────────────────────────────

test('the role vocabulary matches the database check constraint', () => {
  assert.equal(ROLE.OWNER, 'owner');
  assert.equal(ROLE.AUDITOR, 'auditor');
  assert.equal(ROLE.REVIEWER, 'reviewer');
});

test('internal is owner and auditor, mirroring private.is_internal()', () => {
  assert.deepEqual([...INTERNAL_ROLES].sort(), ['auditor', 'owner']);
  assert.equal(isInternalRole('owner'), true);
  assert.equal(isInternalRole('auditor'), true);
  assert.equal(isInternalRole('reviewer'), false);
  // Permitted by the constraint, held by nobody, named by no policy.
  assert.equal(isInternalRole('finance'), false);
  assert.equal(isInternalRole('viewer'), false);
});

test('admin is owner alone, mirroring private.is_owner()', () => {
  assert.equal(isAdminRole('owner'), true);
  assert.equal(isAdminRole('auditor'), false);
  assert.equal(isAdminRole('reviewer'), false);
  assert.equal(isAdminRole(null), false);
  assert.equal(isAdminRole(undefined), false);
});

test('reviewer is reviewer alone, mirroring private.is_reviewer()', () => {
  assert.equal(isReviewerRole('reviewer'), true);
  assert.equal(isReviewerRole('owner'), false);
  assert.equal(isReviewerRole('auditor'), false);
});

// ── requirement 1 and 2: the admin reaches everything ───────────────────────

test('an owner may edit an audit created by another auditor', () => {
  assert.equal(canEditAudit({ role: 'owner', userId: ADMIN, audit: THEIRS }), true);
});

test('an owner may edit every audit, whoever owns it', () => {
  for (const owner of [ADMIN, AUDITOR, OTHER]) {
    assert.equal(canEditAudit({ role: 'owner', userId: ADMIN, audit: ownedBy(owner) }), true, owner);
  }
});

test('an owner may resume an audit created by another auditor', () => {
  assert.equal(canResumeAudit({ role: 'owner', userId: ADMIN, audit: THEIRS }), true);
  assert.equal(resumeRefusal({ role: 'owner', userId: ADMIN, audit: THEIRS }), null,
    'and is given no refusal to display');
});

test('an owner is not blocked by a missing auditor_id', () => {
  // An audit with no recorded owner is administratively reachable, which is
  // exactly the case an administrator exists for.
  assert.equal(canEditAudit({ role: 'owner', userId: ADMIN, audit: ORPHANED }), true);
});

test('an owner sees no refusal, so the UI shows no disabled state', () => {
  // Requirement 6. The "Another auditor" chip renders on !resumable, so an
  // owner never sees it.
  const resumable = canResumeAudit({ role: 'owner', userId: ADMIN, audit: THEIRS });
  assert.equal(resumable, true);
});

// ── requirement 3: ordinary auditors are unchanged ──────────────────────────

test('an auditor may edit their own audit', () => {
  assert.equal(canEditAudit({ role: 'auditor', userId: AUDITOR, audit: MINE }), true);
});

test('an auditor may not edit another auditor\'s audit', () => {
  // The whole reason Phase 6.1 exists. This must not regress.
  assert.equal(canEditAudit({ role: 'auditor', userId: AUDITOR, audit: THEIRS }), false);
  assert.equal(canResumeAudit({ role: 'auditor', userId: AUDITOR, audit: THEIRS }), false);
  assert.equal(resumeRefusal({ role: 'auditor', userId: AUDITOR, audit: THEIRS }), 'not-yours');
});

test('an auditor may not edit an audit with no recorded owner', () => {
  // Refusing is the conservative reading: the database would refuse it too,
  // because auditor_id = auth.uid() cannot be satisfied by null.
  assert.equal(canEditAudit({ role: 'auditor', userId: AUDITOR, audit: ORPHANED }), false);
  assert.equal(resumeRefusal({ role: 'auditor', userId: AUDITOR, audit: ORPHANED }), 'unknown-owner');
});

test('granting an owner does not widen any other auditor', () => {
  // Postgres ORs permissive policies, so adding "owner manages all" cannot
  // grant an auditor anything. Asserted because it is the safety claim the
  // whole migration rests on.
  assert.equal(canEditAudit({ role: 'auditor', userId: AUDITOR, audit: THEIRS }), false);
  assert.equal(canEditAudit({ role: 'auditor', userId: OTHER, audit: MINE }), false);
});

// ── requirement 4: reviewers stay read-only ─────────────────────────────────

test('a reviewer may edit nothing at all', () => {
  for (const audit of [MINE, THEIRS, ORPHANED]) {
    assert.equal(canEditAudit({ role: 'reviewer', userId: REVIEWER, audit }), false);
  }
});

test('a reviewer may not edit even an audit they somehow own', () => {
  // Refused on the role, before ownership is consulted. There is no ALL policy
  // for a reviewer anywhere in the schema and there must never be one.
  assert.equal(canEditAudit({ role: 'reviewer', userId: REVIEWER, audit: ownedBy(REVIEWER) }), false);
});

test('a reviewer may still read every audit', () => {
  assert.equal(canViewAudit({ role: 'reviewer' }), true);
  assert.equal(canBrowseAudits('reviewer'), true);
});

test('a reviewer refusal is named as such, not as an ownership problem', () => {
  assert.equal(resumeRefusal({ role: 'reviewer', userId: REVIEWER, audit: THEIRS }), 'reviewer');
});

// ── reading is wider than writing, deliberately ─────────────────────────────

test('every internal role and the reviewer may browse', () => {
  assert.equal(canBrowseAudits('owner'), true);
  assert.equal(canBrowseAudits('auditor'), true);
  assert.equal(canBrowseAudits('reviewer'), true);
  assert.equal(canBrowseAudits(null), false);
  assert.equal(canBrowseAudits('finance'), false);
});

test('being able to see an audit is not being able to change it', () => {
  // The exact gap that caused the incident, stated as an assertion.
  assert.equal(canBrowseAudits('auditor'), true);
  assert.equal(canEditAudit({ role: 'auditor', userId: AUDITOR, audit: THEIRS }), false);
});

// ── nobody unauthenticated or unknown gets anything ─────────────────────────

test('no session means no write, whatever the role says', () => {
  assert.equal(canEditAudit({ role: 'owner', userId: null, audit: THEIRS }), false);
  assert.equal(canEditAudit({ role: 'auditor', userId: undefined, audit: MINE }), false);
});

test('a missing or unrecognised role writes nothing', () => {
  for (const role of [null, undefined, '', 'finance', 'viewer', 'admin', 'OWNER']) {
    assert.equal(canEditAudit({ role, userId: AUDITOR, audit: MINE }), false, String(role));
  }
});

test('a missing audit is never editable', () => {
  assert.equal(canEditAudit({ role: 'owner', userId: ADMIN, audit: null }), false);
  assert.equal(canEditAudit({ role: 'owner', userId: ADMIN }), false);
  assert.equal(canEditAudit(), false);
});

// ── the production shape, end to end ────────────────────────────────────────

test('the real ownership split behaves correctly for both tiers', () => {
  // Production holds audits across three auditors. Before the fix, any of them
  // could open all of them writably; after it, only the owner can.
  const audits = [ownedBy(ADMIN), ownedBy(AUDITOR), ownedBy(OTHER)];

  const asAdmin = audits.filter((a) => canEditAudit({ role: 'owner', userId: ADMIN, audit: a }));
  assert.equal(asAdmin.length, 3, 'the administrator reaches all three');

  const asAuditor = audits.filter((a) => canEditAudit({ role: 'auditor', userId: AUDITOR, audit: a }));
  assert.equal(asAuditor.length, 1, 'an ordinary auditor reaches only its own');
  assert.equal(asAuditor[0].auditor_id, AUDITOR);

  const asReviewer = audits.filter((a) => canEditAudit({ role: 'reviewer', userId: REVIEWER, audit: a }));
  assert.equal(asReviewer.length, 0, 'and a reviewer reaches none');
});
