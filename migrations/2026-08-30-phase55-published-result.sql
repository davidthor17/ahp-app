-- Phase 5.5: the frozen public representation of a published audit
--
-- NOT APPLIED. Prepared for review. Nothing in this file has been run against
-- the Supabase project.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: public.audits (7 rows). No other table.
--
-- One nullable column. No update, no delete, no truncate, no backfill, no
-- default. Every existing row keeps a null, and a null is the instruction to
-- the public report to keep rendering that audit exactly as it does today.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Why this column exists
--
-- The public report was a live query. It read the property row as it stands
-- now, so renaming or recategorising a hotel silently rewrote the heading of
-- every report it had ever had. It recomputed the score in the browser from
-- audit_items rows that stay writable after publication. And it carried its own
-- list of 13 sections while the checklist had grown to 15, so items in
-- Facilities and Safety counted toward the headline figure and then vanished
-- from the breakdown.
--
-- A published report should be a document: a statement of what was found, fixed
-- at the moment it was issued. This column is that document. Everything the
-- public page renders is computed once, at publish time, and written here. The
-- reader renders this and consults nothing else.
--
-- The payload deliberately carries only what the public product already shows.
-- No certification level, no weight classes, no coverage, no derived findings,
-- no facility profile, no framework or checklist version. Forensic questions are
-- answered by the columns in the Phase 4B migration, not by a public payload.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.audits
  add column if not exists published_result jsonb;

comment on column public.audits.published_result is
  'Frozen public representation of this audit, written once at publish time. '
  'The public report renders this and reads nothing else. Null means the audit '
  'was published before payloads existed, and its report still recomputes from '
  'audit_items as it always has. Shape is versioned by its own formatVersion '
  'field; a reader that does not recognise the version must refuse to render '
  'rather than fall back to live data.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- NO CONSTRAINT
--
-- A check constraint was considered and rejected. Any constraint strong enough
-- to be worth having, that formatVersion is present, that score exists, that
-- sections is an array, would have to permit null for the seven existing rows,
-- and would then duplicate in SQL a contract that is already enforced in two
-- places that matter more:
--
--   the writer  refuses to publish a payload that fails validation, so a
--               malformed payload never reaches this column
--   the reader  validates independently and fails closed, showing an
--               unavailable state rather than recomputing a different number
--
-- A third copy in a check constraint would be the one nobody updates when the
-- contract moves to version 2, and a stale constraint that rejects a valid
-- payload would break publishing outright. The reader is the only place where
-- being strict is genuinely safe, because the worst it can do is decline to
-- render.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO INDEX
--
-- The column is read only by primary lookup on ref, never filtered or joined on.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW EXISTING ROWS BEHAVE
--
--   audits            one new column, null on all 7 rows
--   audit_items       untouched
--   properties        untouched
--   AHP-2026-8B10     published_result null, so its report keeps recomputing.
--                     It shows 58 per cent, no Mark, 2 critical failures, and
--                     gains only the approved legacy disclosure line. Its score
--                     is not recalculated and is not replaced by a framework
--                     score.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO BACKFILL
--
-- Deliberately absent, and it should stay absent. A payload written today for
-- an audit published months ago would have to take the property state as it
-- stands now and the sections as the checklist defines them now, then stamp the
-- result with a publishedAt that is not when it was published. That is a
-- reconstruction wearing the clothes of a record, which is the thing this whole
-- sequence of work exists to prevent. Null is the honest value, and the legacy
-- path renders it correctly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORDER
--
-- Independent of the Phase 4B and Phase 4C migrations. It touches no column
-- either of those adds and neither touches this one. It may be applied before
-- or after both. The writer must not be deployed until this has been applied,
-- or every publish fails on a missing column.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   begin;
--   alter table public.audits drop column if exists published_result;
--   commit;
--
-- Safe at any time. The reader treats a missing column exactly as it treats a
-- null one, so dropping it returns every report to the recompute path rather
-- than breaking any page. The cost is that every payload written since the
-- migration is destroyed, and those cannot be rebuilt honestly afterwards, so
-- export them first if any audit has been published in the meantime:
--
--   select ref, published_result from public.audits where published_result is not null;
