-- Phase 6.1: give the `owner` role the administrative reach it already implies
--
-- NOT APPLIED. Prepared for review.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: adds one function and four policies. No table is altered, no row
--           is read, written or deleted, and no existing policy is dropped or
--           modified.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ROLE ALREADY EXISTS AND DOES NOTHING
--
-- public.auditors.role is constrained to owner, auditor, finance, viewer,
-- reviewer. `owner` has been in that list from the beginning, and
-- private.is_internal() already resolves it:
--
--   select coalesce(private.current_auditor_role() in ('owner','auditor'), false)
--
-- But every write policy in the schema is shaped the same way:
--
--   audits             (auditor_id  = auth.uid()) and private.is_internal()
--   audit_items        (audit.auditor_id = auth.uid()) and private.is_internal()
--   audit_item_photos  (audit.auditor_id = auth.uid()) and private.is_internal()
--   properties         (created_by  = auth.uid()) and private.is_internal()
--
-- So an owner today has exactly the powers of an auditor and not one more.
-- The role is vocabulary with nothing behind it. That is the hook this uses:
-- there is no need to hardcode an email address anywhere, because the model
-- already has the right shape and simply has no rule that honours it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NEW POLICIES RATHER THAN EDITED ONES
--
-- Postgres combines permissive policies with OR. Adding a policy can therefore
-- only ever grant, never revoke, and every existing policy keeps working
-- untouched and unexamined. An ordinary auditor is unaffected by all of this:
-- is_owner() is false for them, so the new policies contribute nothing and
-- their access is decided exactly as it is today.
--
-- Editing the four existing policies in place would have meant dropping and
-- recreating them, which is a window in which the table is governed by
-- something other than what was reviewed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not grant a reviewer anything. There is no ALL policy for a reviewer
-- anywhere in this schema and none is added here, so read-only stays read-only.
--
-- It does not promote anybody. Nobody holds the owner role today, so applying
-- this migration alone changes what precisely nothing can do. Granting the role
-- to an account is a separate, explicit, one-row decision, deliberately kept
-- out of a migration so that it can never happen as a side effect of a schema
-- change.
--
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Mirrors is_reviewer exactly: same shape, same STABLE SECURITY DEFINER, same
-- pinned search_path, and it inherits the access_expires_at check that
-- current_auditor_role() already applies, so an expired owner is not an owner.
create or replace function private.is_owner()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(private.current_auditor_role() = 'owner', false)
$function$;

comment on function private.is_owner() is
  'True for a non-expired account holding the owner role. The administrative tier: owner may manage every audit, not only its own.';

-- The four tables an audit is made of. Each gets one permissive ALL policy
-- that turns on the role alone, which is what "manage every audit" means.
create policy "owner manages all audits"
  on public.audits
  for all
  using (private.is_owner())
  with check (private.is_owner());

create policy "owner manages all audit items"
  on public.audit_items
  for all
  using (private.is_owner())
  with check (private.is_owner());

create policy "owner manages all audit item photos"
  on public.audit_item_photos
  for all
  using (private.is_owner())
  with check (private.is_owner());

-- Properties too. An owner resuming somebody else's audit presses BEGIN AUDIT,
-- which upserts the property row; without this that write is refused and the
-- audit is administratively reachable but practically not.
create policy "owner manages all properties"
  on public.properties
  for all
  using (private.is_owner())
  with check (private.is_owner());

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE
--
-- Deliberately not here. The audit-evidence policies live in
-- 2026-09-09-phase60-photo-storage.sql and are edited in
-- 2026-09-09-phase61-owner-admin-storage.sql, because that file is the one
-- held to the storage rule set rather than the schema one.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW EXISTING ACCESS BEHAVES
--
--   auditor    unchanged. is_owner() is false, the new policies contribute
--              nothing, and "manages own" decides everything exactly as now.
--   reviewer   unchanged. Still SELECT only, on every table.
--   anon       unchanged. Still published audits only.
--   owner      may now manage every audit, item, photo and property.
--
-- No audit, item, property or published report is read or written by this
-- migration. AHP-2026-8B10 and AHP-2026-D699 are untouched.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLOUT ORDER
--
--   1. apply this migration and the storage one
--   2. grant the owner role to the account, as a separate explicit statement
--   3. deploy the code
--
-- Backend before UI, on purpose. The console decides what to offer from the
-- role it reads, so a UI that offered administrative access before the
-- policies existed would produce exactly the 42501 dead end Phase 6.1 was
-- written to remove.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='private' and p.proname='is_owner';          -- 1 row
--
--   select tablename, policyname from pg_policies
--    where schemaname='public' and policyname like 'owner manages%'
--    order by tablename;                                          -- 4 rows
--
--   select count(*) from public.auditors where role='owner';      -- expect 0
--   -- until the grant is made deliberately
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   begin;
--   drop policy if exists "owner manages all properties"        on public.properties;
--   drop policy if exists "owner manages all audit item photos" on public.audit_item_photos;
--   drop policy if exists "owner manages all audit items"       on public.audit_items;
--   drop policy if exists "owner manages all audits"            on public.audits;
--   drop function if exists private.is_owner();
--   commit;
--
-- Safe at any time. It removes an administrative grant and takes nothing else
-- with it, because nothing else references is_owner(). Demote the account
-- first if the intent is to remove the privilege rather than the mechanism.
