-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-overpass-cache-2026-09-08.sql
--
-- Shared server-side cache for OpenStreetMap Overpass results, so the
-- "מצא מוסך" screen stops depending on a public API we are rate-limited on.
--
-- WHY
--   `curl https://overpass-api.de/api/status` reports `Rate limit: 2` — two
--   concurrent query slots PER IP. Every request from this app egresses from
--   the shared Supabase Edge IP pool, so all users of the feature compete for
--   those two slots globally. That is the mechanism behind "sometimes finds,
--   sometimes doesn't", and it gets worse with every new user, not better.
--
--   Measured 2026-09-08 against overpass-api.de from Tel Aviv centre, after
--   removing the pathological `name~"פנצ"` clause: 0.9-3.5s per query. Good,
--   but only while we are the only caller. This table makes the FIRST user in
--   an area pay that cost and serves everyone else from Postgres.
--
-- WHY NOT GOOGLE PLACES INSTEAD
--   Places would be better data, and its free tier would probably cover this
--   app's volume. But Maps Platform Service Specific Terms 14.3 permits
--   caching only latitude, longitude and place_id, for at most 30 days —
--   i.e. it forbids exactly the table below. And 14.2 forbids showing Places
--   content on a non-Google map, which would force replacing Leaflet in
--   MapCore (shared with the fleet and route maps). OSM's ODbL permits
--   caching and redistribution with attribution. The cache is the reason to
--   stay on OSM, not a workaround for having stayed.
--
-- WHY A TABLE AND NOT THE CLIENT'S localStorage
--   The client cache already exists (`fg_v4:` keys) and stays — it makes a
--   revisit instant and works offline. But it is per-device: it does nothing
--   for the first visit, nothing for a new user, and nothing for the rate
--   limit, because every device still has to make its own upstream call.
--   Only a shared cache collapses N users onto 1 upstream query.
--
-- SAFETY
--   Additive only: one new table, two new functions. No change to any
--   existing table, no trigger, no change to anyone else's RLS. Idempotent
--   and re-runnable.
--
-- APPLY
--   Supabase SQL Editor, once. Then record the apply in the ledger:
--     node scripts/sql-ledger.cjs record supabase-overpass-cache-2026-09-08.sql
--   (CLAUDE.md gate 5: staging shares this database with production, so this
--   runs against live data. It is additive, so nothing existing is touched.)
--   The overpass-proxy Edge Function must be redeployed after this runs; it
--   soft-fails to direct upstream fetches until the table exists, so the
--   order of the two does not matter and neither step breaks the other.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. table ──────────────────────────────────────────────────────────────
create table if not exists public.overpass_cache (
  -- sha256 hex of the whitespace-normalised Overpass query. The query text
  -- IS the identity: the client snaps its coordinates to a ~1km grid and its
  -- radius to a fixed ladder before building the query, so two users in the
  -- same neighbourhood asking for the same radius produce byte-identical
  -- queries and therefore the same key. See FindGarage.jsx `canonical…`.
  cache_key       text        primary key,

  -- Kept for debugging and for answering "what did this row actually ask?"
  -- without reverse-engineering a hash. Also lets us find and purge a whole
  -- class of stale query shapes after a query change.
  query           text        not null,

  -- The upstream Overpass JSON, stored verbatim. Deliberately NOT reshaped
  -- into the client's row format: the proxy is a generic Overpass relay and
  -- must not grow knowledge of one screen's view model.
  payload         jsonb       not null,

  -- Denormalised from payload so the "never cache an empty answer" rule is
  -- enforceable in a CHECK rather than trusted to callers.
  element_count   integer     not null,

  fetched_at      timestamptz not null default now(),

  -- Soft expiry. Past this, the row is still served (garages do not move)
  -- but one caller is elected to refresh it. See overpass_cache_get.
  expires_at      timestamptz not null,

  -- Hard expiry. Past this the row is worthless and treated as absent.
  hard_expires_at timestamptz not null,

  -- Refresh election. Whoever sets this wins the right to call upstream;
  -- everyone else keeps being served the stale payload meanwhile. Bounded in
  -- time so a crashed Edge invocation cannot wedge a cell forever.
  locked_until    timestamptz,

  hit_count       integer     not null default 0,
  last_hit_at     timestamptz,

  -- An empty result must never be cached. A mirror that soft-timed out and a
  -- genuinely empty desert both return `elements: []`, and they are
  -- indistinguishable here — so pinning either one would risk showing
  -- "לא נמצאו תוצאות" for the whole TTL. This is the same bug that the
  -- client-side `fg_v3` cache shipped with; encoding it as a constraint is
  -- what stops it recurring on this side.
  constraint overpass_cache_nonempty_chk check (element_count > 0),
  constraint overpass_cache_horizon_chk  check (hard_expires_at >= expires_at)
);

comment on table public.overpass_cache is
  'Shared cache of OpenStreetMap Overpass responses for the Find-Garage screen. Written only by the overpass-proxy Edge Function (service_role). Exists because overpass-api.de allows 2 concurrent slots per IP and all app traffic shares one egress IP.';

-- Sweep index. The only query that does not lead with the primary key is the
-- opportunistic "delete what is past its hard horizon" in overpass_cache_put.
create index if not exists overpass_cache_hard_expires_idx
  on public.overpass_cache (hard_expires_at);

-- ── 2. RLS ────────────────────────────────────────────────────────────────
-- Enabled with NO policies, deliberately. This table is written and read
-- exclusively by the overpass-proxy Edge Function using the service role,
-- which bypasses RLS. Zero policies therefore means anon and authenticated
-- callers can neither read nor write it, and no future client code can start
-- depending on it by accident.
alter table public.overpass_cache enable row level security;

-- ── 3. read path ──────────────────────────────────────────────────────────
-- Returns the cached payload and tells the caller what to do about it.
--
--   cache_hit = false                       → nothing usable; caller fetches.
--   cache_hit = true, should_refresh = false → serve this payload as-is.
--   cache_hit = true, should_refresh = true  → serve/return it, but you are
--                                           the elected refresher: fetch
--                                           upstream and overpass_cache_put.
--
-- The first column is `cache_hit` and NOT `found`: PL/pgSQL has a special
-- boolean variable named FOUND, and a RETURNS TABLE column becomes an OUT
-- parameter in the same scope. Naming it `found` shadows the built-in, which
-- breaks every `if not found` in the body.
--
-- Why elect a single refresher instead of letting every caller past the TTL
-- go upstream: that stampede is precisely what exhausts the 2 upstream slots.
-- On expiry, one caller refreshes and every concurrent caller is still served
-- instantly from the stale row. Garage locations tolerate hours of staleness;
-- the feature does not tolerate a queue.
create or replace function public.overpass_cache_get(p_key text)
returns table (
  cache_hit      boolean,
  payload        jsonb,
  element_count  integer,
  fetched_at     timestamptz,
  is_stale       boolean,
  should_refresh boolean
)
language plpgsql
-- SECURITY INVOKER (the default) on purpose. The caller is service_role,
-- which bypasses RLS anyway, so there is no reason to hand this function
-- definer rights and widen the blast radius if execute is ever granted more
-- broadly than intended.
set search_path = public, pg_temp
as $$
declare
  v_row   public.overpass_cache;
  v_stale boolean;
  v_won   boolean := false;
begin
  -- Lock the row for the duration of the transaction so two concurrent
  -- callers cannot both win the refresh election. Without FOR UPDATE the
  -- read-then-write below is a classic race and the stampede guard is
  -- decorative.
  select * into v_row
    from public.overpass_cache
   where cache_key = p_key
     for update;

  -- Existence is tested via v_row.cache_key (the column is NOT NULL, so it
  -- is null only when nothing matched) rather than PL/pgSQL's FOUND, which
  -- this function must not rely on — see the header note on the `cache_hit`
  -- column name.
  if v_row.cache_key is null or v_row.hard_expires_at <= now() then
    return query select false, null::jsonb, null::integer, null::timestamptz, false, false;
    return;
  end if;

  v_stale := v_row.expires_at <= now();

  if v_stale and (v_row.locked_until is null or v_row.locked_until <= now()) then
    -- Claim the refresh. 45s is comfortably above the measured upstream p100
    -- (~3.5s at the widest radius, 27s if a mirror has to time out first),
    -- and short enough that a dead invocation frees the cell quickly.
    update public.overpass_cache
       set locked_until = now() + interval '45 seconds',
           hit_count    = hit_count + 1,
           last_hit_at  = now()
     where cache_key = p_key;
    v_won := true;
  else
    update public.overpass_cache
       set hit_count   = hit_count + 1,
           last_hit_at = now()
     where cache_key = p_key;
  end if;

  return query select true, v_row.payload, v_row.element_count, v_row.fetched_at, v_stale, v_won;
end;
$$;

comment on function public.overpass_cache_get(text) is
  'Read-through cache lookup for overpass-proxy. Serves stale rows and elects exactly one caller to refresh, so an expiring hot cell cannot stampede the 2 upstream Overpass slots.';

-- ── 4. write path ─────────────────────────────────────────────────────────
-- Upsert a fresh payload, release the refresh lock, and opportunistically
-- sweep rows past their hard horizon.
--
-- p_ttl_seconds   soft expiry — how long before a refresh is elected.
-- p_stale_seconds hard expiry — how long the row may still be served stale.
create or replace function public.overpass_cache_put(
  p_key           text,
  p_query         text,
  p_payload       jsonb,
  p_element_count integer,
  p_ttl_seconds   integer default 86400,     -- 24h
  p_stale_seconds integer default 604800     -- 7d
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Refuse to store an empty answer. The CHECK constraint would reject it
  -- anyway; failing here with a clear message keeps the Edge Function's
  -- error log readable instead of surfacing a constraint violation.
  if p_element_count is null or p_element_count <= 0 then
    raise exception 'overpass_cache_put: refusing to cache an empty result for %', p_key
      using hint = 'An empty Overpass response is indistinguishable from a soft timeout. Let the next request re-ask.';
  end if;

  insert into public.overpass_cache (
    cache_key, query, payload, element_count,
    fetched_at, expires_at, hard_expires_at, locked_until
  )
  values (
    p_key, p_query, p_payload, p_element_count,
    now(),
    now() + make_interval(secs => p_ttl_seconds),
    now() + make_interval(secs => p_stale_seconds),
    null
  )
  on conflict (cache_key) do update
    set query           = excluded.query,
        payload         = excluded.payload,
        element_count   = excluded.element_count,
        fetched_at      = excluded.fetched_at,
        expires_at      = excluded.expires_at,
        hard_expires_at = excluded.hard_expires_at,
        -- Releasing the lock is the point: the refresher has delivered.
        locked_until    = null;

  -- Opportunistic sweep instead of a pg_cron job. CLAUDE.md classifies
  -- cron-registering SQL as NEEDS_REVIEW, and this table does not need
  -- scheduling precision — a bounded delete on write keeps it from growing
  -- without adding another scheduled dependency to reason about. Capped so a
  -- single request never pays for a large backlog.
  delete from public.overpass_cache
   where cache_key in (
     select cache_key
       from public.overpass_cache
      where hard_expires_at < now()
      limit 50
   );
end;
$$;

comment on function public.overpass_cache_put(text, text, jsonb, integer, integer, integer) is
  'Store a fresh Overpass payload, release the refresh lock, and sweep up to 50 rows past their hard horizon. Rejects empty results by design.';

-- ── 5. lock down execute ──────────────────────────────────────────────────
-- Only the Edge Function (service_role) may call these. postgres keeps
-- execute so the functions remain maintainable from the SQL editor.
revoke all on function public.overpass_cache_get(text) from public, anon, authenticated;
revoke all on function public.overpass_cache_put(text, text, jsonb, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.overpass_cache_get(text) to service_role;
grant execute on function public.overpass_cache_put(text, text, jsonb, integer, integer, integer) to service_role;

-- ── 6. verify ─────────────────────────────────────────────────────────────
-- One paste, one row. Expect: t | 0 | 2 | 0.
--
--   select
--     (select relrowsecurity from pg_class
--       where oid = 'public.overpass_cache'::regclass)              as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'overpass_cache') as policies,
--     (select count(*) from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('overpass_cache_get', 'overpass_cache_put')) as functions,
--     (select count(*) from public.overpass_cache)                   as rows_now;
--
-- (`proname in (...)` rather than `like 'overpass_cache%'`: in LIKE the
-- underscore is a single-character wildcard, so the pattern would also match
-- names this migration did not create.)
--
-- Empty results must be rejected — this should raise, not insert:
--   select public.overpass_cache_put('t','q','{"elements":[]}'::jsonb, 0);
--
-- Once the feature has run for a day, this is the health query. A high
-- hit_count with a low row count is the cache working as intended:
--   select count(*)                             as cells,
--          sum(hit_count)                       as hits,
--          round(avg(element_count))            as avg_elements,
--          pg_size_pretty(sum(pg_column_size(payload))) as payload_bytes
--     from public.overpass_cache;
--
-- ROLLBACK (nothing else references these; the proxy soft-fails without them):
--   drop function if exists public.overpass_cache_put(text, text, jsonb, integer, integer, integer);
--   drop function if exists public.overpass_cache_get(text);
--   drop table if exists public.overpass_cache;
