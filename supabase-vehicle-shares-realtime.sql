-- ==========================================================================
-- Enable Supabase Realtime publication for the tables that drive the
-- two-sided sync (`useSharedVehicleRealtime` hook):
--   * app_notifications  → bell + page invalidation on new rows
--   * vehicle_shares     → dashboard repaint when a share lifecycle
--                          event lands (revoke / accept / leave)
--
-- supabase_realtime is the default publication created by every
-- Supabase project; adding a table to it is what flips on the
-- "Realtime" toggle the dashboard exposes.
--
-- Idempotent: safe to re-run. The `do $$ ... if not exists ...$$` guard
-- keeps the second run from raising "is already member of publication".
-- ==========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'app_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.app_notifications';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'vehicle_shares'
  ) then
    execute 'alter publication supabase_realtime add table public.vehicle_shares';
  end if;
end $$;
