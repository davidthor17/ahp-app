-- Phase 4B: scoring integrity
--
-- NOT APPLIED. Prepared for review. Nothing in this file has been run against
-- the Supabase project, and the application works without it: the snapshot,
-- the N/A reasons and the audit trail are all held in the audit's local store
-- until these columns exist.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: public.audits (7 rows), public.audit_items (141 rows),
--           public.activity_log (0 rows, policy only)
--
-- Every column is additive and nullable. No existing value is overwritten and
-- no row is deleted. Scoring falls back to the live property row wherever a
-- snapshot is null, which is exactly today's behaviour, so applying this
-- changes no published result on its own.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The audit's frozen scoring basis
--
-- Why on the audit and not only on the property: a property record is a
-- statement about now, an audit is a statement about a moment. Without this,
-- a hotel closing its spa or being recategorised silently rescores every audit
-- it has ever had, including published ones.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.audits
  add column if not exists property_category  text,
  add column if not exists facility_profile   jsonb,
  add column if not exists scope_sections     text[],
  add column if not exists framework_version  text,
  add column if not exists checklist_version  text,
  add column if not exists snapshot_locked_at timestamptz;

comment on column public.audits.property_category is
  'Star category this audit was scored against, frozen at the first graded item. Null means the audit predates the snapshot and falls back to properties.category.';
comment on column public.audits.facility_profile is
  'Facility flags this audit was scored against: { hasRestaurant, hasPool, hasSpa }. Frozen with property_category.';
comment on column public.audits.scope_sections is
  'Declared Spot Audit scope, as section ids. Null means the whole catalogue.';
comment on column public.audits.snapshot_locked_at is
  'When the scoring basis was frozen. Null means never locked.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Why an item does not apply
--
-- N/A carried two incompatible meanings. Structural N/A removes an item from
-- the audit and is capped at 5% of applicable weight; observational N/A leaves
-- it in scope and costs coverage.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.audit_items
  add column if not exists na_reason text,
  add column if not exists na_note   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_items_na_reason_check') then
    alter table public.audit_items
      add constraint audit_items_na_reason_check
      check (na_reason is null or na_reason in ('not_offered', 'not_present', 'not_observed'));
  end if;
end $$;

comment on column public.audit_items.na_reason is
  'Why the item does not apply. not_offered and not_present are structural and remove the item from the audit; not_observed leaves it in scope as unassessed. Null on rows recorded before reasons existed, which the engine reads as not_observed.';

-- Deliberately NOT backfilled. A null reason is read as observational, which
-- is the conservative choice: it can lower a historical score but never raise
-- one. Writing not_observed into these rows would look like a recorded
-- decision when it is an inference, so the inference stays in the code.
--
--   select count(*) from public.audit_items where status = 'na';   -- expect 0

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Audit trail
--
-- public.activity_log already exists with the right shape and already lets
-- internal users insert, so no new table. Reviewers need to read it: the
-- existing policy is private.is_internal() only, and reviewers are handled by
-- separate is_reviewer() policies elsewhere in the schema.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_log'
      and policyname = 'reviewer reads activity log'
  ) then
    create policy "reviewer reads activity log"
      on public.activity_log for select
      to authenticated
      using (private.is_reviewer());
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Safe at any point. The application reads every one of these columns
-- defensively and behaves as it does today when they are absent.
-- ─────────────────────────────────────────────────────────────────────────────
--
--   begin;
--   drop policy if exists "reviewer reads activity log" on public.activity_log;
--   alter table public.audit_items drop constraint if exists audit_items_na_reason_check;
--   alter table public.audit_items drop column if exists na_note;
--   alter table public.audit_items drop column if exists na_reason;
--   alter table public.audits drop column if exists snapshot_locked_at;
--   alter table public.audits drop column if exists checklist_version;
--   alter table public.audits drop column if exists framework_version;
--   alter table public.audits drop column if exists scope_sections;
--   alter table public.audits drop column if exists facility_profile;
--   alter table public.audits drop column if exists property_category;
--   commit;
--
-- Dropping loses any snapshot recorded since the migration ran, so take a
-- snapshot of public.audits first if any audit has been graded by then.

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILLING THE SEVEN EXISTING AUDITS
--
-- Deliberately a separate, unwritten step. The only basis available is the
-- property row as it stands today, which is a reconstruction rather than a
-- record: nobody knows whether those properties have changed since. Presenting
-- a reconstruction as a recorded fact is the very thing this phase exists to
-- prevent, so it needs its own decision.
--
-- If approved, it would look like this, and would want an accompanying
-- activity_log entry per audit marking the values as reconstructed:
--
--   update public.audits a
--      set property_category = p.category,
--          facility_profile  = jsonb_build_object(
--            'hasRestaurant', p.has_restaurant,
--            'hasPool',       p.has_pool,
--            'hasSpa',        p.has_spa),
--          framework_version = null,        -- unknown, and honest about it
--          checklist_version = null
--     from public.properties p
--    where p.id = a.property_id
--      and a.property_category is null;
