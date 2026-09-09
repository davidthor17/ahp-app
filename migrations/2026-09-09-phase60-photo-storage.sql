-- Phase 6.0: the audit-evidence Storage bucket and its access rules
--
-- NOT APPLIED. Prepared for review.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: creates one row in storage.buckets and four policies on
--           storage.objects. No table in the public schema is touched, and no
--           audit, audit item, property or evidence row is read or written.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS A SEPARATE FILE
--
-- Every other migration in this repository is held to a blanket rule that the
-- word "insert" may not appear in an executable statement, because the thing
-- that rule exists to stop is a backfill of audit data. A Storage bucket is a
-- row in storage.buckets, so creating one needs an insert and cannot satisfy
-- that rule.
--
-- Rather than weaken the rule for every file, the schema migration keeps it
-- intact and this file carries a narrower one that is checked separately:
-- it may touch storage only, and it must not reference public.audits,
-- public.audit_items, public.properties or public.audit_item_photos at all.
-- test/migration-safety.test.js enforces both halves.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THERE IS NOTHING HERE TODAY
--
-- The project has no Storage buckets and no Storage policies. storage.objects
-- is empty. Everything below is new, so nothing can be overwritten.
--
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Private. Not "private by default": private, with no public read path at all.
-- Files are served through short-lived signed URLs created for a caller who has
-- already passed the policies below.
--
-- The limits are evidence limits, not camera limits. The console downscales
-- before upload, so a file arriving near 10 MB means the resize did not run and
-- should fail loudly rather than quietly cost an auditor their upload budget on
-- hotel wifi.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audit-evidence',
  'audit-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- POLICIES
--
-- Postgres RLS on audit_item_photos protects the metadata and nothing else.
-- Storage is a separate system with its own table and its own policies, and an
-- object with no policy is simply unreachable rather than public, so these have
-- to state the same model again in full.
--
-- The model they state is the one the database already uses:
--
--   internal writes its own      audits.auditor_id = auth.uid()
--   internal reads all           private.is_internal()
--   reviewer reads all           private.is_reviewer()
--   public reads nothing
--
-- Every path check keys on the FIRST folder segment, which is the audit id.
-- That is what makes a path unguessable-by-construction rather than merely
-- unguessable: an auditor can write only beneath their own audit's folder, so
-- a hand-crafted path pointing at another audit is refused by the policy, not
-- by the client.
-- ─────────────────────────────────────────────────────────────────────────────

-- Write, replace and remove, but only under an audit that belongs to the
-- caller. Mirrors "internal manages own audit items".
create policy "internal manages own audit evidence"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'audit-evidence'
    and private.is_internal()
    and exists (
      select 1 from public.audits a
      where a.id::text = (storage.foldername(name))[1]
        and a.auditor_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'audit-evidence'
    and private.is_internal()
    and exists (
      select 1 from public.audits a
      where a.id::text = (storage.foldername(name))[1]
        and a.auditor_id = auth.uid()
    )
  );

-- Internal staff read every audit's evidence, as they already read every
-- audit's items.
create policy "internal reads all audit evidence"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'audit-evidence'
    and private.is_internal()
  );

-- A reviewer reads and never writes. There is no ALL policy for a reviewer
-- here, deliberately, exactly as there is none on audit_items.
create policy "reviewer reads all audit evidence"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'audit-evidence'
    and private.is_reviewer()
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IS DELIBERATELY ABSENT
--
-- No policy grants anon anything. An unauthenticated caller cannot list, read,
-- write or delete a single object in this bucket, and the published report has
-- no access to evidence of any kind. Phase 6.0 does not publish photos, and the
-- absence of a public policy is what guarantees that rather than the absence of
-- a feature in the UI.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
--
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'audit-evidence';
--   -- expect: audit-evidence, false, 10485760, {image/jpeg,image/png,image/webp}
--
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--   -- expect exactly the three above, all for {authenticated}
--
--   select count(*) from storage.objects where bucket_id = 'audit-evidence';
--   -- expect 0
--
-- Negative check, run as an auditor who does not own audit X, which must
-- return zero rows rather than an error:
--
--   select name from storage.objects
--    where bucket_id = 'audit-evidence'
--      and (storage.foldername(name))[1] = 'X';
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   begin;
--   drop policy if exists "reviewer reads all audit evidence" on storage.objects;
--   drop policy if exists "internal reads all audit evidence" on storage.objects;
--   drop policy if exists "internal manages own audit evidence" on storage.objects;
--   delete from storage.buckets where id = 'audit-evidence';
--   commit;
--
-- The bucket delete fails while objects remain, which is the correct order:
-- evidence must be exported deliberately before the bucket can go.
