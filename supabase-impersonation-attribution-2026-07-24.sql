-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-impersonation-attribution-2026-07-24.sql
-- Row-level attribution for writes made while an admin is impersonating.
--
-- THE PROBLEM REAL IMPERSONATION CREATES
--   Approach B hands the admin a token whose sub IS the target, which is what
--   makes every policy and RPC work unchanged. The cost is that writes look
--   like the user's own: auth.uid() is genuinely them, so nothing in the row
--   says an admin was holding the keyboard. admin_view_sessions records that
--   someone was inside during a window; it cannot say which row they touched.
--
-- HOW THIS GETS IT BACK
--   admin-impersonate signs a non-standard `impersonated_by` claim into the
--   token. PostgREST exposes the whole claim set through auth.jwt(), so a
--   trigger can read it and stamp the row. auth.uid() stays the target — RLS
--   is untouched — while the row itself remembers who acted.
--
--   A normal session has no such claim, so acting_admin_id is NULL and the
--   trigger costs one jsonb lookup per write.
--
-- VISIBILITY
--   The column is admin-only by convention: nothing in the client selects it,
--   and the user-facing surfaces list explicit columns. It is evidence for
--   whoever audits, not a badge shown to the customer.
--
-- SCOPE
--   Five tables carrying the changes a support session would plausibly make.
--   Adding more later is one line each — but note this is an allowlist too,
--   and allowlists rot. Prefer widening it when a table starts mattering
--   rather than assuming the list stays right.
--
-- DEPENDS ON: the admin-impersonate Edge Function issuing `impersonated_by`.
-- Harmless to apply first: with no such token the column simply stays NULL.
-- Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The stamp ──────────────────────────────────────────────────────────
create or replace function public.stamp_acting_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- nullif('') guards the case where the claim is present but empty; a bad
  -- cast here would abort a legitimate write, so the failure mode has to be
  -- "no attribution", never "no write".
  begin
    new.acting_admin_id := nullif(auth.jwt() ->> 'impersonated_by', '')::uuid;
  exception when others then
    new.acting_admin_id := null;
  end;
  return new;
end $$;


-- ── 2. Column + trigger per table ─────────────────────────────────────────
do $$
declare
  t text;
  tables text[] := array[
    'vehicles',
    'documents',
    'maintenance_logs',
    'accidents',
    'vehicle_expenses'
  ];
begin
  foreach t in array tables loop
    -- Skip tables that don't exist on this project rather than aborting the
    -- whole migration — the schema has drifted by hand for a long time.
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not found', t;
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists acting_admin_id uuid', t
    );

    execute format('drop trigger if exists trg_stamp_acting_admin on public.%I', t);
    execute format(
      'create trigger trg_stamp_acting_admin
         before insert or update on public.%I
         for each row execute function public.stamp_acting_admin()', t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════════
--   -- Column present on all five:
--   select table_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'acting_admin_id'
--    order by table_name;
--
--   -- Triggers attached:
--   select relname as table_name, tgname
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where tgname = 'trg_stamp_acting_admin' order by 1;
--
--   -- After a support session, everything an admin touched as someone else:
--   select 'vehicles' as tbl, id, acting_admin_id, updated_at
--     from public.vehicles where acting_admin_id is not null
--    order by updated_at desc limit 20;
-- ═══════════════════════════════════════════════════════════════════════════
