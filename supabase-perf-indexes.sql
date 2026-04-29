-- ==========================================================================
-- Performance indexes — non-breaking, additive only.
--
-- Targets the hot paths the audit flagged as the slowest queries:
--   * vehicles(account_id) — every Dashboard / Vehicles / Fleet page
--     filters by account_id. Without this index PostgreSQL planned a
--     sequential scan on every load.
--   * app_notifications(user_id, is_read, created_at desc) — the bell
--     fetches the last 10 unread per user on every mount.
--   * community_notifications(user_id, is_read, created_at desc) — same
--     shape as app_notifications, same hot path.
--   * vehicle_shares(shared_with_user_id) — my_vehicles_v joins this on
--     every Dashboard render to detect shared vehicles.
--
-- Why CONCURRENTLY: these CREATE INDEX statements DO NOT lock the table
-- against writes. They take longer wall-clock but allow the app to keep
-- serving traffic while the index builds. CREATE INDEX IF NOT EXISTS
-- means the script is idempotent — running it twice is a no-op.
--
-- Reversible:
--   drop index if exists vehicles_account_id_perf_idx;
--   drop index if exists app_notifications_user_unread_perf_idx;
--   drop index if exists community_notifications_user_unread_perf_idx;
--   drop index if exists vehicle_shares_recipient_perf_idx;
-- ==========================================================================

-- Vehicles: every workspace-scoped read filters by account_id. The
-- existing repair_logs_account_idx covers repair_logs but vehicles
-- itself was unindexed on this column.
create index concurrently if not exists vehicles_account_id_perf_idx
  on public.vehicles(account_id);

-- App notifications: the bell reads (user_id, is_read=false, ordered
-- by created_at desc, limit 10). A composite index on these columns
-- in this order turns a sequential scan into an index-only seek.
create index concurrently if not exists app_notifications_user_unread_perf_idx
  on public.app_notifications(user_id, is_read, created_at desc);

-- Community notifications: same access pattern as app_notifications.
create index concurrently if not exists community_notifications_user_unread_perf_idx
  on public.community_notifications(user_id, is_read, created_at desc);

-- Vehicle shares lookup: my_vehicles_v joins vehicle_shares on the
-- recipient (shared_with_user_id) to surface "shared with me"
-- vehicles. The owner-side index already exists; this covers the
-- recipient side which the Dashboard view hits.
-- Wrapped in a do-block so the script doesn't fail if the column or
-- table is named differently in this deployment — the audit's column
-- name was inferred from usage, not from the schema.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'vehicle_shares'
      and column_name  = 'shared_with_user_id'
  ) then
    execute 'create index concurrently if not exists vehicle_shares_recipient_perf_idx '
         || 'on public.vehicle_shares(shared_with_user_id)';
  end if;
end $$;
