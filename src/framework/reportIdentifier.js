// Phase 6.7 security remediation.
//
// genAuditRef() replaces the inline generator that used to live in App.jsx:
// `AHP-${year}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` — a
// 4-character base36 suffix (~20.7 bits per year) drawn from a generator
// Node's and every browser's own documentation says must not be used for
// anything security-sensitive. Until the public report boundary moves to
// public_token (migrations/2026-09-10-phase67-public-report-security.sql),
// this ref is the entire access control for a public report URL
// (speculaone.com/report.html?ref=...), so "not security-sensitive" was
// never true of it.
//
// Same visible shape — AHP-{year}-{suffix} — so nothing about ref's role as
// a human-readable label anywhere else in the console changes. Two things
// are different: the entropy source, and the width.
//
//   source   crypto.getRandomValues(), a CSPRNG, not Math.random()
//   width    8 hex characters instead of 4 base36 characters
//
// Hex, not base36, and deliberately: two hex digits map to one byte with no
// bias (16 values from 256, evenly), where base36's 36 does not divide 256
// evenly and would skew some characters very slightly more likely than
// others. 8 hex characters is 32 bits — about 4.3 billion values per year,
// roughly 1,600x the old keyspace — drawn from 4 random bytes, two hex
// characters each.
//
// This is the safest fix available entirely within this repository. It does
// not, on its own, close the guessability gap in the current public URL
// scheme: speculaone-web still looks reports up by ref, and a wider keyspace
// is a slower brute force, not an impossible one. Closing that gap for real
// is what public_token (122 bits, a real UUID) is for, once speculaone-web
// is updated to require it — a change to that repository, not this one.
//
// Phase 7.2: speculaone-web now reads every report through one function,
// public.get_public_report, by exact token or exact ref, and anon can no longer
// list audits. New links are shared by token (publicReportLink below). ?ref=
// links keep working, so no issued link is ever invalidated.

const HEX = '0123456789ABCDEF';

/** True if a CSPRNG is available in this runtime. False only in a runtime
 *  with no Web Crypto API at all, which no supported browser lacks. */
export function hasSecureRandom() {
  return typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
}

/**
 * 8 uppercase hex characters, drawn from 4 cryptographically random bytes.
 * Exported on its own so the entropy source and the formatting can each be
 * tested directly, without also depending on the current year.
 */
export function randomSuffix() {
  const bytes = new Uint8Array(4);
  if (hasSecureRandom()) {
    crypto.getRandomValues(bytes);
  } else {
    // Unreachable in any supported browser or in Node 19+; kept only so a
    // stripped-down runtime fails safe (a working, if weaker, ref) rather
    // than throwing where the console previously worked.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0x0f];
  return out;
}

/** AHP-{year}-{8 hex chars}, e.g. "AHP-2026-9F3C7A2B". */
export function genAuditRef(now = new Date()) {
  return `AHP-${now.getFullYear()}-${randomSuffix()}`;
}

export const REPORT_PAGE = 'speculaone.com/report.html';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The public link for an audit's report. By token whenever the console knows
 * it, which is every signed-in session once the audit row has been read. By ref
 * only until then: a ref link still opens the same report, it is just the
 * guessable one. Null when there is nothing to link to.
 */
export function publicReportLink({ publicToken, ref } = {}) {
  if (typeof publicToken === 'string' && UUID.test(publicToken)) return `${REPORT_PAGE}?token=${publicToken}`;
  if (typeof ref === 'string' && ref) return `${REPORT_PAGE}?ref=${encodeURIComponent(ref)}`;
  return null;
}
