-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-transfer-preview-by-id-2026-09-11.sql
--
-- preview_vehicle_transfer also answers by transfer id, not only by token.
--
-- Third and last companion to supabase-vehicle-transfer-2026-09-11.sql, which
-- is applied and recorded and must not be edited.
--
-- ═══ THE DEFECT THIS CLOSES ══════════════════════════════════════════════
--
-- A transfer reaches its recipient two ways:
--
--   ?token=…   a link in an email or WhatsApp, for somebody who may not have
--              an account yet
--   ?id=…      an in-app notification, for somebody who already does
--
-- preview_vehicle_transfer took a token only, so the SECOND path had nothing
-- to show. The in-app recipient saw a generic card with no counts, no date
-- range and no vehicle, and was asked to approve on less information than a
-- stranger holding a link — which is exactly backwards, and it is the common
-- case for an existing user.
--
-- ═══ WHY THE ID PATH IS GATED AND THE TOKEN PATH IS NOT ══════════════════
--
-- A token is a 64-character secret: holding one IS the authorisation, which is
-- why anon may call this at all, and why the payload is deliberately thin
-- (counts and a date range, never row content and never the licence plate).
--
-- A transfer id is not a secret. It appears in app_notifications.data and will
-- appear in URLs. So the id branch requires a signed-in caller whose own auth
-- email matches the invited address — the same check accept_vehicle_transfer
-- makes. Without it, this function would become a way to ask "is there an open
-- offer on this id, and what is in it" for any id at all.
--
-- Both branches still return ZERO ROWS rather than an error when the answer is
-- no. An error would distinguish "wrong id" from "not yours", and that
-- difference is itself information.
--
-- ═══ WHY DROP AND RECREATE ═══════════════════════════════════════════════
--
-- Adding a parameter makes a NEW signature. CREATE OR REPLACE would leave the
-- old preview_vehicle_transfer(text) in place beside the new one, and a call
-- with a single text argument would then be ambiguous. The drop is explicit,
-- and the grants are restated below because a dropped function takes its
-- privileges with it.
--
-- SAFETY
--   Idempotent. Touches nothing but this one function. The client currently
--   calls it with a named p_token only, which keeps working unchanged.
--
-- APPLY
--   Supabase SQL Editor, once, then:
--     node scripts/sql-ledger.cjs record supabase-transfer-preview-by-id-2026-09-11.sql
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.preview_vehicle_transfer(text);

create or replace function public.preview_vehicle_transfer(
  p_token       text default null,
  p_transfer_id uuid default null
)
returns table (
  transfer_id    uuid,
  manufacturer   text,
  model          text,
  year           integer,
  vehicle_type   text,
  sender_name    text,
  service_count  integer,
  accident_count integer,
  oldest_record  date,
  newest_record  date,
  manifest       jsonb,
  expires_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.vehicle_transfers;
  v public.vehicles;
  n text;
begin
  -- ⚠️ EVERY TABLE HERE CARRIES AN ALIAS, deliberately. A RETURNS TABLE column
  -- becomes a PL/pgSQL variable, so `expires_at`, `manifest`, `year`, `model`
  -- and `transfer_id` all collide with real columns on the tables below. The
  -- first version of this function raised 42702 "column reference expires_at
  -- is ambiguous" on its very first call — a PL/pgSQL body is not checked when
  -- the function is created, so it applied perfectly cleanly and failed later.
  if p_token is not null then
    -- Holding the token is the authorisation.
    select * into t from public.vehicle_transfers vt
     where vt.invite_token = p_token
       and vt.status = 'pending'
       and vt.expires_at > now();
  elsif p_transfer_id is not null then
    -- An id is not a secret, so this branch checks the caller instead.
    select * into t from public.vehicle_transfers vt
     where vt.id = p_transfer_id
       and vt.status = 'pending'
       and vt.expires_at > now()
       and exists (
         select 1 from auth.users au
          where au.id = auth.uid()
            and lower(au.email) = lower(vt.to_email)
       );
  else
    return;
  end if;

  if t.id is null then return; end if;

  select * into v from public.vehicles veh where veh.id = t.vehicle_id;
  -- auth.users, because public.user_profiles has no full_name or email column
  -- and reading them from there fails at plan time. NO email fallback: this
  -- answers whoever holds the link, and the sender's address is not theirs.
  select coalesce(au.raw_user_meta_data->>'full_name', 'משתמש') into n
    from auth.users au where au.id = t.from_user_id;

  return query
  select t.id, v.manufacturer, v.model, v.year, v.vehicle_type,
         coalesce(n, 'משתמש'),
         (select count(*)::integer from public.maintenance_logs m where m.vehicle_id = v.id),
         (select count(*)::integer from public.accidents a      where a.vehicle_id = v.id),
         (select min(m.date)::date  from public.maintenance_logs m where m.vehicle_id = v.id),
         (select max(m.date)::date  from public.maintenance_logs m where m.vehicle_id = v.id),
         t.manifest, t.expires_at;
end;
$$;

revoke all on function public.preview_vehicle_transfer(text, uuid) from public;
-- anon stays on the list: the whole point of PATH B is that a stranger sees
-- the offer BEFORE being asked to register.
grant execute on function public.preview_vehicle_transfer(text, uuid) to anon, authenticated;


-- ── verify ────────────────────────────────────────────────────────────────
-- Exactly ONE preview function must exist, with two arguments:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'preview_vehicle_transfer';
--   -- expect one row: preview_vehicle_transfer | text, uuid
--
-- A stranger's token still reveals nothing, and still does not error:
--   select count(*) from public.preview_vehicle_transfer(p_token => 'not-a-real-token');  -- 0
--
-- And an id nobody was invited to reveals nothing either:
--   select count(*) from public.preview_vehicle_transfer(
--            p_transfer_id => '00000000-0000-0000-0000-000000000000');                    -- 0
--
-- ROLLBACK:
--   drop function if exists public.preview_vehicle_transfer(text, uuid);
--   -- then re-create the single-argument version from
--   -- supabase-vehicle-transfer-2026-09-11.sql, and re-grant it to
--   -- anon, authenticated.
