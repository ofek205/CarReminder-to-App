-- ==========================================================================
-- Accident extras — Phase 2 of the AddAccident rework
--
-- Two additions:
-- 1) accident_details gains 3 columns for the offending vehicle
--    (manufacturer / model / year). The UI already collects these via the
--    plate-lookup autofill flow, but today they have nowhere to live in the
--    DB, so everything the user typed was silently discarded.
--
-- 2) repair_logs gains a self-referencing nullable `accident_log_id` so a
--    follow-up repair ("bumper replacement after the accident on May 3")
--    can point at the original accident log. One accident → many repairs.
--    ON DELETE SET NULL — if the parent accident is deleted we keep the
--    repair rows (they're independent work records) but drop the link.
--
-- Idempotent: safe to re-run.
-- ==========================================================================

-- 1) accident_details: offending-vehicle columns
alter table public.accident_details
  add column if not exists other_driver_manufacturer text,
  add column if not exists other_driver_model        text,
  add column if not exists other_driver_year         text;   -- keep text: Hebrew UI lets users type e.g. "2024" or skip

-- 2) repair_logs: optional link to an accident repair_log
alter table public.repair_logs
  add column if not exists accident_log_id uuid
    references public.repair_logs(id) on delete set null;

-- Lookup "all repairs linked to accident X" quickly.
create index if not exists repair_logs_accident_idx
  on public.repair_logs(accident_log_id)
  where accident_log_id is not null;

-- Reload PostgREST schema cache so new columns are immediately queryable
-- without a server restart.
notify pgrst, 'reload schema';
