-- Phase 6.0: photo evidence attached to an evaluated audit item
--
-- NOT APPLIED. Prepared for review.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: creates public.audit_item_photos. No existing table is altered,
--           no existing row is read, written or deleted.
--
-- Storage buckets and Storage policies are NOT here. They live in
-- 2026-09-09-phase60-photo-storage.sql, because creating a bucket is a row in
-- storage.buckets and this file is held to a strict no-INSERT rule.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHICH ROW A PHOTO BELONGS TO
--
-- audit_items has a uuid primary key, and it is genuinely stable. It is not
-- what this table references, for one practical reason: the console has never
-- read it. pushItem upserts on the natural key and does not select the id
-- back, so no client anywhere knows a row's uuid. Threading it through would
-- mean changing the Phase 5.8 write path and its in-memory queue, which is the
-- most safety-critical code in the app, for no gain in integrity.
--
-- Instead this references the same row through the key the client does hold:
--
--   unique (audit_id, item_id, shift_id)
--
-- That is a real key with a unique constraint behind it, so the composite
-- foreign key below is enforced exactly as a uuid reference would be, cascades
-- on delete exactly as a uuid reference would, and cannot point at a row that
-- does not exist.
--
-- The shift matters and is deliberately part of the key. The same checklist
-- item is evaluated once per shift, and AHP-2026-D699 already holds items
-- graded 'missed' on one shift and 'met' on another. A photo that attached to
-- (audit, item) alone would be evidence for a verdict nobody could identify.
--
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.audit_item_photos (
  id             uuid primary key default uuid_generate_v4(),

  -- The evaluated row this is evidence for. All three are part of the foreign
  -- key below and none may be null: a photo with no shift would be ambiguous
  -- the moment the same item is assessed twice.
  audit_id       uuid not null,
  item_id        text not null,
  shift_id       text not null,

  -- Where the file actually is, inside the audit-evidence bucket. Recorded
  -- rather than derived so that a path scheme change later cannot orphan
  -- everything written under the old one.
  storage_path   text not null,

  -- What the file is, for rendering and for spotting a truncated upload.
  mime_type      text,
  byte_size      integer,
  width          integer,
  height         integer,

  -- Who attached it. Nullable because the auditors row is the app's own
  -- record, and evidence must not be refused if that lookup ever fails.
  uploaded_by    uuid references public.auditors(id) on delete set null,

  created_at     timestamptz not null default now(),

  -- Phase 6.0 keeps every photo internal. This is the hook that lets a later
  -- phase publish a chosen few without another migration, and false is the
  -- only safe default: evidence is private until somebody decides otherwise.
  include_in_report boolean not null default false,

  -- Deleting the audit takes its evidence with it, and deleting an evaluated
  -- row takes the evidence for that verdict with it. Both match the cascade
  -- audit_items already has onto audits.
  constraint audit_item_photos_item_fkey
    foreign key (audit_id, item_id, shift_id)
    references public.audit_items (audit_id, item_id, shift_id)
    on delete cascade,

  -- One storage object is referenced once. Stops a retry that already
  -- succeeded from recording the same file twice.
  constraint audit_item_photos_storage_path_key unique (storage_path),

  constraint audit_item_photos_byte_size_check check (byte_size is null or byte_size > 0)
);

-- Reading every photo for an audit is what the console does on load, and
-- reading them for one item is what a card does on render.
create index if not exists idx_audit_item_photos_audit
  on public.audit_item_photos (audit_id);
create index if not exists idx_audit_item_photos_item
  on public.audit_item_photos (audit_id, item_id, shift_id);

comment on table public.audit_item_photos is
  'Photo evidence for one evaluated audit item, in one shift. Files live in the audit-evidence Storage bucket; this table holds only the metadata and the path.';
comment on column public.audit_item_photos.storage_path is
  'Path inside the audit-evidence bucket: {audit_id}/{item_id}/{shift_id}/{photo_id}.{ext}. The first segment is the audit id, which is what the Storage policies gate on.';
comment on column public.audit_item_photos.include_in_report is
  'Reserved for a later phase. Phase 6.0 never publishes evidence, and nothing reads this yet.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--
-- Deliberately identical in shape to the audit_items policies, so evidence can
-- never be reachable by somebody who could not already read the grade it
-- belongs to. The one difference is the absence of a public policy: there is no
-- "public reads photos of published audits" here, because Phase 6.0 does not
-- publish evidence and a policy written now would be the thing that leaked it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_item_photos enable row level security;

-- An auditor or owner may attach, amend and remove evidence, but only on an
-- audit that is theirs. Same subquery as "internal manages own audit items".
create policy "internal manages own audit item photos"
  on public.audit_item_photos
  for all
  using (
    exists (
      select 1 from public.audits a
      where a.id = audit_item_photos.audit_id
        and a.auditor_id = auth.uid()
    )
    and private.is_internal()
  )
  with check (
    exists (
      select 1 from public.audits a
      where a.id = audit_item_photos.audit_id
        and a.auditor_id = auth.uid()
    )
    and private.is_internal()
  );

-- Internal staff read everything, as they already do for audits and items.
create policy "internal reads all audit item photos"
  on public.audit_item_photos
  for select
  using (private.is_internal());

-- A reviewer reads and never writes. There is no ALL policy for a reviewer
-- anywhere in this schema and there must not be one here.
create policy "reviewer reads all audit item photos"
  on public.audit_item_photos
  for select
  using (private.is_reviewer());

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- HOW EXISTING DATA BEHAVES
--
--   audits            unchanged, no column touched
--   audit_items       unchanged, no column touched
--   properties        unchanged, no column touched
--   published reports unchanged, published_result is a frozen payload and is
--                     not recomputed from anything here
--
-- Nothing is backfilled. No historical audit gains evidence, and none can:
-- evidence is created only by an auditor attaching a file. AHP-2026-8B10 and
-- AHP-2026-D699 are untouched by this migration and by the code that uses it.
--
-- Photos are evidence only. They do not participate in applicability, progress,
-- scoring, the checklist pin, the snapshot basis, tier logic, or legacy audit
-- classification. Nothing in the scoring engine reads this table.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLOUT ORDER
--
--   1. apply this migration
--   2. apply 2026-09-09-phase60-photo-storage.sql
--   3. deploy the code
--
-- The code inserts into this table and uploads to that bucket, so both must
-- exist first. The reverse order fails with 42P01 on the table or a bucket-not
-- -found on the upload, and in both cases a photo the auditor believes is
-- attached would not be.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
--
--   select count(*) from public.audit_item_photos;             -- expect 0
--   select count(*) from public.audits;                        -- expect 7
--   select count(*) from public.audit_items;                   -- expect 214
--   select relrowsecurity from pg_class
--    where oid = 'public.audit_item_photos'::regclass;          -- expect true
--   select count(*) from pg_policies
--    where schemaname='public' and tablename='audit_item_photos'; -- expect 3
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   begin;
--   drop table if exists public.audit_item_photos;
--   commit;
--
-- Safe while no evidence has been attached. Once it has, dropping the table
-- leaves every file in the bucket with nothing pointing at it. Capture first:
--
--   select audit_id, item_id, shift_id, storage_path
--     from public.audit_item_photos order by created_at;
