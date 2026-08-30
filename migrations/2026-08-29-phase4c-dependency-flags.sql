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

-- Nullable, with no default. Null means nobody has been asked yet, which is
-- the truth for all seven existing properties: nothing in the schema
-- establishes any of these five for any of them.
--
-- A not-null default of true would have been equally safe for scoring, since
-- the engine reads a missing flag as present either way, but it would have
-- erased the difference between "we know it is there" and "nobody has said",
-- permanently and with no way to recover it. Null keeps the unknowns findable.
alter table public.properties
  add column if not exists has_sauna          boolean,
  add column if not exists has_changing_rooms boolean,
  add column if not exists has_minibar        boolean,
  add column if not exists has_lunch_service  boolean,
  add column if not exists has_gym            boolean;

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
-- WHY THE COLUMNS ARE NULLABLE
--
-- Three states matter and only two of them are booleans:
--
--   true   the property has it, recorded by someone who looked
--   false  the property does not have it, recorded by someone who looked
--   null   nobody has been asked
--
-- Null is the truth for all seven existing rows. Nothing in the schema
-- establishes a sauna, changing rooms, a minibar, lunch service or a gym for
-- any of them, so writing true would state a fact nobody has established.
--
-- Scoring is unaffected either way: isApplicable() gates only on an explicit
-- false, and rowToProp maps null to present, so a null flag keeps every item
-- the property already had. No historical score can move and no audit can
-- lose an applicable item. What null adds is that the unknowns stay findable:
--
--   select name from public.properties where has_gym is null;
--
-- With a not-null default that query returns nothing, forever.
--
-- The asymmetry is deliberate. A wrong true only adds requirements, which an
-- auditor will notice and correct. A wrong false silently removes them, and
-- nobody notices. So false has to be a recorded decision, never an absence of
-- one, and null must never be read as false.
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
