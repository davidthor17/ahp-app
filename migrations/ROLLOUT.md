# Production rollout order

Kept beside the migrations it sequences. Nothing here has been run.

## Order

1. Capture the production baseline
2. **Apply Migration B**, `2026-08-29-phase4c-dependency-flags.sql`
3. Verify schema and existing data unchanged
4. **Apply Migration C**, `2026-08-30-phase55-published-result.sql`
5. Verify schema and existing data unchanged
6. Deploy `ahp-app`
7. Deploy `speculaone-web`
8. Controlled production smoke test
9. Verify the frozen published report
10. Final production baseline

**Migration A**, `2026-08-28-phase4b-scoring-integrity.sql`, remains deferred.

Both migrations come before both deployments. That is not a preference. Each
deployment hard-depends on a migration, and in both cases the dependency was
confirmed against production rather than assumed.

## Why B is required

`propToRow` in `src/App.jsx` spreads `dependencyFlagsToRow(p)`, which emits a
column for every dependency flag holding an explicit boolean. The initial
property state sets all five to `true`, so **every** property write emits all
five columns, whether or not anybody touched them.

Without B those columns do not exist. `ensureRemoteAudit` fails at the property
insert with `42703 column has_gym does not exist`, the catch returns the
unchanged ids, `ids.auditId` stays null, and the audit is never created in the
database. The auditor sees a sync indicator turn to error, keeps working
locally, and cannot publish. It affects every new audit.

B was originally described as deferrable. It is not. That was corrected in
Phase 5.6 after the Phase 5.5 changes made the write path unconditional.

## Why C is required

`publishAudit` writes `published_result`, so publishing fails without the
column. That much was known.

What was confirmed in Phase 5.6.1 is the other half: `report.js` **selects**
`published_result`, and PostgREST rejects the whole query when a selected column
does not exist. Verified directly against production:

```
GET /rest/v1/audits?select=id,ref,published_result&ref=eq.AHP-2026-8B10
  400  {"code":"42703","message":"column audits.published_result does not exist"}

GET /rest/v1/audits?select=id,ref,tier,status&ref=eq.AHP-2026-8B10
  200  [{"ref":"AHP-2026-8B10","tier":"full","status":"published"}]
```

So deploying `speculaone-web` before C would not degrade the report, it would
take **every published report offline** with "This report isn't available."

This is deliberately not coded around. A reader that silently tolerated a
missing column would be a reader that silently tolerates a missing payload, and
the whole point of the phase is that it must not. Strict ordering is the answer,
and the failure is loud and reversible by promoting the previous deployment.

## Why A stays deferred

Nothing deployed writes or reads its eight columns. `pushItem` still drops
`na_reason` before Supabase, and `report.js` does not select
`snapshot_locked_at`. Applying A now would leave eight columns permanently null
and invite exactly the backfill this work exists to prevent. When A is
scheduled, the `na_reason` write path and the `snapshot_locked_at` select must
be picked up in the same change.

## Rollback ordering

The reverse, for the same reason. Promote the previous deployments first, then
drop columns. Dropping C's column while the new report is live breaks every
published report; dropping B's columns while the new console is live breaks
every new audit.

1. Promote the previous `speculaone-web` deployment
2. Promote the previous `ahp-app` deployment
3. **Export first**: `select ref, published_result from public.audits where published_result is not null;`
4. Delete any smoke-test rows, items before audits before properties
5. Drop `audits.published_result`
6. Drop the five `properties` columns

Step 3 is not optional. A payload rebuilt later would carry today's property
state and a publication timestamp that is not when it was published, which is
the reconstruction this work exists to prevent.

---

# Smoke test data and cleanup

There is no unpublish. `publishAudit` sets `status` to published and nothing in
the console sets it back, so a smoke-test publish creates a permanently public
report at a real speculaone.com URL until it is removed by SQL. The cleanup
below is written before the test runs, not after.

## The test property

Name it exactly:

```
ZZ TEST DO NOT USE, Specula rollout check
```

Chosen so it sorts last, reads as test data to anyone who sees it, cannot
collide with a real hotel, and can be matched by a `like 'ZZ TEST%'` prefix that
cannot match anything else. Category 5★, restaurant and pool on, spa off, Gym
set to No, Minibar set to Yes, the other three left Unknown.

Do **not** reuse an existing property, and do **not** open one of the six
existing drafts. Publishing an existing legacy draft would write a payload to a
real audit row: correct behaviour, but not something to do by accident during a
smoke test.

## What the test creates

| Table | Rows | How to find them |
| --- | --- | --- |
| `properties` | 1 | `name like 'ZZ TEST%'` |
| `audits` | 2, one Full and one Spot | the two refs the console generates |
| `audit_items` | roughly 12 to 30 | by `audit_id` |
| `auditors` | 0 new | the operator's own row already exists |
| `activity_log` | 0 | the trail is still queued locally, never written |

Record both generated refs before starting cleanup. They are the only handle on
the audit rows, and the console does not display them anywhere after publishing
except on the finish screen.

## Cleanup, in this order

Children before parents, or the foreign keys will refuse.

```sql
-- 0. Confirm exactly what is about to be removed. Expect 2 audits, 1 property.
select id, ref, status from public.audits
 where property_id in (select id from public.properties where name like 'ZZ TEST%');
select id, name from public.properties where name like 'ZZ TEST%';

-- 1. Items
delete from public.audit_items
 where audit_id in (
   select id from public.audits
    where property_id in (select id from public.properties where name like 'ZZ TEST%'));

-- 2. Audits
delete from public.audits
 where property_id in (select id from public.properties where name like 'ZZ TEST%');

-- 3. Property
delete from public.properties where name like 'ZZ TEST%';
```

Every statement is scoped by the property name prefix, so none of them can
reach AHP-2026-8B10 or any existing draft. Run step 0 first and read the output;
if it returns anything other than the two test audits and the one test property,
stop.

## Manual SQL is required for

- All three deletes. The console has no delete flow of any kind.
- Un-publishing, if cleanup is deferred:
  `update public.audits set status = 'draft' where ref = '<test ref>';`
  This removes the public report immediately while leaving the row for
  inspection. Prefer this if anything about the test needs investigating before
  the rows are destroyed.

## After cleanup

Rerun the full baseline. Every figure must be back to:

```
audits 7 · published 1 · audit_items 143 · properties 7 · activity_log 0
newest audit update  2026-08-09 10:14:08.622167+00
AHP-2026-8B10        published, 2026-07-23 10:59:42.544798+00, 137 items
audits with published_result   0
properties with an answered flag   0
```

The last two lines are the ones that prove the test cleaned up after itself
rather than leaving a payload or an answered property question behind.
