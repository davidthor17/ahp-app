-- Phase 6.1: the owner role reaches audit evidence too
--
-- NOT APPLIED. Prepared for review.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: adds one policy on storage.objects. No bucket is created or
--           changed, no object is read, written or deleted, and no public
--           schema table is touched.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS SEPARATE
--
-- Same reason as the Phase 6.0 split: storage migrations are checked against a
-- narrower rule set than schema ones, and the two must not be mixed in a file.
-- This one carries no insert at all, so it satisfies both.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY IT IS NEEDED
--
-- Postgres RLS on audit_item_photos protects the metadata. The file itself is
-- governed by a completely separate policy set on storage.objects, and the
-- Phase 6.0 write policy keys on ownership in the same way the table does:
--
--   "internal manages own audit evidence"
--     bucket_id = 'audit-evidence'
--     and private.is_internal()
--     and exists (select 1 from public.audits a
--                 where a.id::text = (storage.foldername(name))[1]
--                   and a.auditor_id = auth.uid())
--
-- So without this an owner could delete a photo's metadata row and not the
-- file behind it. The deletion path reports that honestly as ORPHANED rather
-- than as success, which means the administrative access would work but leave
-- a trail of unreferenced files. Granting the file half closes that.
--
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Scoped to the bucket and to the role, and to authenticated only, exactly
-- like the three policies it joins. Permissive, so it can only grant: an
-- auditor and a reviewer are decided by the existing policies as before.
create policy "owner manages all audit evidence"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'audit-evidence'
    and private.is_owner()
  )
  with check (
    bucket_id = 'audit-evidence'
    and private.is_owner()
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IS STILL ABSENT
--
-- anon is granted nothing, here or anywhere. There are now four policies on
-- storage.objects and every one of them is `to authenticated` and names the
-- audit-evidence bucket. Evidence still cannot reach a published report.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
--
--   select policyname, cmd, roles from pg_policies
--    where schemaname='storage' and tablename='objects' order by policyname;
--   -- expect 4 policies, all {authenticated}
--
--   select count(*) from pg_policies
--    where schemaname='storage' and tablename='objects' and 'anon' = any(roles);
--   -- expect 0
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   begin;
--   drop policy if exists "owner manages all audit evidence" on storage.objects;
--   commit;
