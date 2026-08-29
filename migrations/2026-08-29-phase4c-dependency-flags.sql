-- Phase 4C: sub-feature applicability flags
--
-- NOT APPLIED. Prepared for review. Nothing here has been run against the
-- Supabase project, and the application works without it: propToRow in
-- App.jsx deliberately does not write these columns yet, so the property
-- upsert cannot fail on a column that does not exist. Until the migration
-- lands the flags live in the audit's local store and in its frozen snapshot,
-- which is what the scoring engine actually reads.
--
-- Project: zbmhfdoqmzzscdklziss
-- Affected: public.properties (7 rows). No other table.
--
-- Five booleans that decide whether a single checklist item applies. Without
-- them, a spa with no sauna had to record SP-04 as not applicable, which then
-- counted against the Foundation assessment allowance and could cost an honest
-- property its certification.

begin;

alter table public.properties
  add column if not exists has_sauna          boolean not null default true,
  add column if not exists has_changing_rooms boolean not null default true,
  add column if not exists has_minibar        boolean not null default true,
  add column if not exists has_lunch_service  boolean not null default true,
  add column if not exists has_gym            boolean not null default true;

comment on column public.properties.has_sauna is
  'Gates SP-04. A spa without a sauna does not carry the item at all.';
comment on column public.properties.has_changing_rooms is
  'Gates SP-02 and SP-03. A spa without changing or wet areas does not carry them.';
comment on column public.properties.has_minibar is
  'Gates RM-10. A room without a minibar does not carry the item.';
comment on column public.properties.has_lunch_service is
  'Gates LUN-02. hasRestaurant does not distinguish meal periods, so a dinner-only restaurant would otherwise carry a lunch fundamental.';
comment on column public.properties.has_gym is
  'Gates FAC-04, FAC-05 and FAC-06. No gym flag existed before, so every hotel without a gym carried three items it could only mark N/A.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE DEFAULT IS TRUE
--
-- default true means every existing row keeps every item it already had, so no
-- historical score can move and no audit can silently lose an applicable item.
-- The engine reads a missing or null flag as present for the same reason, in
-- withDependencyDefaults(). The two agree deliberately: false has to be a
-- recorded decision, never an absence of one.
--
-- The seven existing properties will all read as having a sauna, changing
-- rooms, a minibar, lunch service and a gym. That is wrong for some of them,
-- and it is the safe direction: it can only add items to an audit, never
-- remove them. Correcting a property is an ordinary edit, and once an audit
-- has started the snapshot freezes whatever was true at the time.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW EXISTING ROWS BEHAVE
--
--   properties       five new columns, all true
--   audits           unchanged, no column touched
--   audit_items      unchanged, no column touched
--   published report unchanged, it reads no flag
--
-- Audits already carrying a snapshot keep the facility profile they froze.
-- A snapshot written before these flags existed holds only the three section
-- flags and is still a valid scoring basis; the five are filled in as present
-- when it is resolved.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO BACKFILL OF AUDIT SNAPSHOTS
--
-- Deliberately absent. audits.facility_profile is prepared in the Phase 4B
-- migration and also unapplied, and writing today's property state into a
-- historical audit would present a reconstruction as a record. That needs its
-- own decision, as it did in Phase 4B.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   begin;
--   alter table public.properties drop column if exists has_gym;
--   alter table public.properties drop column if exists has_lunch_service;
--   alter table public.properties drop column if exists has_minibar;
--   alter table public.properties drop column if exists has_changing_rooms;
--   alter table public.properties drop column if exists has_sauna;
--   commit;
--
-- Safe at any time. Dropping loses any recorded false, so if properties have
-- been corrected since the migration ran, capture them first:
--
--   select id, name, has_sauna, has_changing_rooms, has_minibar,
--          has_lunch_service, has_gym
--     from public.properties
--    where not (has_sauna and has_changing_rooms and has_minibar
--               and has_lunch_service and has_gym);
