/**
 * Who may do what, expressed once so the console and the database agree.
 *
 * Phase 6.1. The console used to decide this inline, and it got it wrong in a
 * way that cost a real audit: "internal reads all audits" lets any auditor
 * open anybody's audit, but only "internal manages own audit items" governs
 * writing. Resuming somebody else's audit therefore produced a fully working
 * capture screen in which every write came back 42501 forever.
 *
 * Everything here mirrors a policy that exists in the database. Nothing here
 * grants anything: if these functions and the policies ever disagree, the
 * database wins and the auditor is handed a refusal they cannot act on. The
 * point of stating the rules here is to stop the console offering a door the
 * database will not open.
 *
 *   role      reads                  writes
 *   owner     every audit            every audit          owner manages all *
 *   auditor   every audit            its own audits       internal manages own *
 *   reviewer  every audit            nothing              no ALL policy exists
 *   anon      published audits only  nothing
 */

export const ROLE = Object.freeze({
  OWNER: 'owner',
  AUDITOR: 'auditor',
  REVIEWER: 'reviewer',
});

/**
 * Roles the console treats as staff.
 *
 * Matches private.is_internal(), which is `role in ('owner','auditor')`. The
 * schema's check constraint also permits 'finance' and 'viewer'; neither is
 * held by anybody and no policy mentions them, so neither is internal here.
 */
export const INTERNAL_ROLES = Object.freeze([ROLE.OWNER, ROLE.AUDITOR]);

/** Mirrors private.is_owner(). The administrative tier. */
export const isAdminRole = (role) => role === ROLE.OWNER;

/** Mirrors private.is_internal(). */
export const isInternalRole = (role) => INTERNAL_ROLES.includes(role);

/** Mirrors private.is_reviewer(). */
export const isReviewerRole = (role) => role === ROLE.REVIEWER;

/** May this role open the audit list at all? Reads, not writes. */
export const canBrowseAudits = (role) => isInternalRole(role) || isReviewerRole(role);

/**
 * May this account write to this audit?
 *
 * The two write policies, in the order Postgres ORs them together. A reviewer
 * is refused explicitly rather than by omission, because read-only is a
 * promise this app makes and it should be visible in the code that keeps it.
 */
export function canEditAudit({ role, userId, audit } = {}) {
  if (!userId || !audit) return false;
  if (isReviewerRole(role)) return false;
  if (isAdminRole(role)) return true;
  if (!isInternalRole(role)) return false;
  return Boolean(audit.auditor_id) && audit.auditor_id === userId;
}

/**
 * May this account resume this audit writably?
 *
 * The same question as canEditAudit today. It has its own name because the
 * resume path is where the mismatch actually bit, and because a future reason
 * to refuse a resume that is not about authorization belongs here rather than
 * inside a permission check.
 */
export const canResumeAudit = (args) => canEditAudit(args);

/**
 * May this account open the audit read only?
 *
 * Everybody internal, and every reviewer. This is "internal reads all audits"
 * and "reviewer reads all audits", and it is deliberately wider than the write
 * rule: being able to look at an audit is not being able to change it.
 */
export const canViewAudit = ({ role } = {}) => canBrowseAudits(role);

/**
 * Why a resume was refused, for a message the auditor can act on.
 *
 * Null when it was not refused. Never mentions row level security: that phrase
 * tells somebody standing in a hotel corridor nothing they can use.
 */
export function resumeRefusal({ role, userId, audit } = {}) {
  if (canResumeAudit({ role, userId, audit })) return null;
  if (isReviewerRole(role)) return 'reviewer';
  if (!audit || !audit.auditor_id) return 'unknown-owner';
  return 'not-yours';
}
