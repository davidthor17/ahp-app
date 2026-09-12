-- Phase 7.2a: one narrow function for the public report.
--
-- Applies to: the public report page, www.speculaone.com/report.html
-- Affected:   adds public.get_public_report(uuid, text); grants EXECUTE on it
--             to anon and authenticated. Changes no table, no row, no grant on
--             any table, and no RLS policy.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- The public report reads audits, audit_items and properties directly as anon,
-- under column grants (Phase 6.7) and row policies that let anon see published
-- rows. A row policy cannot require a request to name one specific row: any row
-- anon may read, anon may also list. Proven against production on 2026-09-11
-- with the publishable key:
--
--   GET /rest/v1/audits?select=id,ref,status           -> every published audit
--   GET /rest/v1/audits?select=ref,public_token        -> every public_token
--   GET /rest/v1/audit_items?...&audit_id=eq.<D699>    -> 111 rows, although
--                                                         D699 renders from its
--                                                         frozen payload and
--                                                         never needs them
--
-- So neither ref nor public_token can be an access boundary while anon holds
-- direct SELECT on those tables. This function is that boundary instead: it
-- returns exactly one published report, and only to a caller who already has
-- that report's exact token or exact ref. It cannot list, search or pattern
-- match. Phase 7.2b then removes anon's direct table access; until 7.2b runs,
-- nothing about the existing public path changes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT RETURNS
--
-- One jsonb envelope, or SQL NULL. NULL for an unknown token, an unknown ref,
-- an unpublished audit and a deleted one alike, so a response never says
-- whether an identifier belongs to a real audit.
--
--   ref, date, tier        always     the reference printed on the report,
--                                     the stay date, the audit type
--   published_result       always     authoritative for every modern report
--   auditor_summary        legacy     the three fields the legacy branch of
--   critical_failures      legacy     report-result.js reads from the raw row
--   properties             legacy     when there is no payload: exactly the
--   items                  legacy     four property columns and the three
--                                     audit_item columns it has always used
--
-- Legacy means published_result IS NULL: today, AHP-2026-8B10 only. A
-- payload-backed report gets no items, no property row and no raw summary,
-- because its frozen payload already carries everything it renders.
--
-- Never returned: the audit's id, property_id, public_token, auditor_id, or
-- any column outside the list above. items carry no audit_id either: the old
-- fallback query used audit_id only as its filter, never as a rendered field.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HARDENING
--
--   security definer   runs as its owner, so it can read the rows anon no
--                      longer may once 7.2b runs
--   set search_path    empty: every relation below is schema-qualified, so a
--                      caller cannot shadow one with an object of their own
--   language sql       one statement, no dynamic SQL, no string building; both
--                      parameters are bound values compared with =
--   stable             reads only; it cannot write
--   token first        when both are supplied the token wins and the ref is
--                      ignored, so a ref can never widen a token lookup
--   exact match        uuid equality for the token, text equality for the
--                      ref; an empty ref matches nothing
--   published only     status = 'published' is part of the lookup itself
--
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.get_public_report(p_token uuid default null, p_ref text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select a.id, a.ref, a.date, a.tier, a.auditor_summary, a.critical_failures,
           a.published_result, a.property_id
      from public.audits a
     where a.status = 'published'
       and (
             (p_token is not null and a.public_token = p_token)
          or (p_token is null and nullif(p_ref, '') is not null and a.ref = p_ref)
           )
     limit 1
  )
  select jsonb_build_object(
           'ref',              t.ref,
           'date',             t.date,
           'tier',             t.tier,
           'published_result', t.published_result,
           'auditor_summary',  case when t.published_result is null then t.auditor_summary end,
           'critical_failures', case when t.published_result is null then t.critical_failures end,
           'properties',       case when t.published_result is null then (
                                 select jsonb_build_object(
                                          'name', p.name, 'city', p.city,
                                          'country', p.country, 'category', p.category)
                                   from public.properties p
                                  where p.id = t.property_id
                               ) end,
           'items',            case when t.published_result is null then coalesce((
                                 select jsonb_agg(jsonb_build_object(
                                          'item_id', i.item_id,
                                          'section_id', i.section_id,
                                          'status', i.status)
                                        order by i.item_id, i.section_id, i.status)
                                   from public.audit_items i
                                  where i.audit_id = t.id
                               ), '[]'::jsonb) end
         )
    from target t;
$$;

comment on function public.get_public_report(uuid, text) is
  'Phase 7.2. The only public read path for a published audit report: exact public_token (preferred) or exact ref, published audits only, one envelope or NULL. Legacy item and property fields only when published_result is null. See migrations/2026-09-11-phase72a-public-report-function.sql.';

-- Functions are executable by PUBLIC by default. Take that away and grant it
-- back to exactly the two API roles that need it.
revoke all on function public.get_public_report(uuid, text) from public;
grant execute on function public.get_public_report(uuid, text) to anon, authenticated;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (anon, publishable key), all before 7.2b:
--
--   POST /rest/v1/rpc/get_public_report  {"p_ref":"AHP-2026-8B10"}
--     -> envelope with items (137) and properties; published_result null
--   POST /rest/v1/rpc/get_public_report  {"p_ref":"AHP-2026-D699"}
--     -> envelope with published_result; items, properties, summary all null
--   POST /rest/v1/rpc/get_public_report  {"p_token":"<D699 public_token>"}
--     -> the same D699 envelope
--   POST /rest/v1/rpc/get_public_report  {"p_token":"00000000-0000-0000-0000-000000000000"}
--     -> null
--   POST /rest/v1/rpc/get_public_report  {"p_ref":"AHP-2026-%"}
--     -> null (no pattern matching)
--
-- ROLLBACK
--
--   drop function if exists public.get_public_report(uuid, text);
--
-- Safe while 7.2b has not been applied: the reader falls back to nothing, so
-- redeploy the previous report.js first if the reader already calls this.
