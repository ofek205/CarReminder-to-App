-- ==========================================================================
-- Missing columns on public.vehicles
--
-- Adds three columns the frontend has been writing/reading for a while but
-- that never existed in the Supabase schema:
--   • vehicle_type_id           — lookup id for vehicle category/subcategory
--   • manufacturer_id           — lookup id for manufacturer
--   • license_plate_normalized  — digits-only plate for duplicate detection
--
-- license_plate_normalized is a GENERATED column so it stays in sync with
-- license_plate automatically (no trigger needed, no client-side sync
-- burden, and it's indexable).
--
-- Safe to re-run.
-- ==========================================================================

alter table public.vehicles
  add column if not exists vehicle_type_id text,
  add column if not exists manufacturer_id text;

-- Generated column: digits-only normalization of license_plate.
-- Mirrors src/components/shared/DateStatusUtils.jsx::normalizePlate()
-- which does: plate.replace(/[^0-9]/g, '')
-- Adding a generated column requires no default clause. If the column
-- already exists (from a prior manual migration) we skip it.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'vehicles'
      and column_name  = 'license_plate_normalized'
  ) then
    execute $ddl$
      alter table public.vehicles
        add column license_plate_normalized text
          generated always as (regexp_replace(coalesce(license_plate, ''), '[^0-9]', '', 'g')) stored
    $ddl$;
  end if;
end $$;

-- Index for duplicate-plate lookups inside an account. Not unique — demo
-- vehicles and legacy rows can legitimately collide; the frontend handles
-- "you already have a vehicle with this plate" as a warning, not a hard
-- constraint.
create index if not exists vehicles_plate_normalized_idx
  on public.vehicles(account_id, license_plate_normalized)
  where license_plate_normalized <> '';

-- Helpful indexes for the lookup-id columns in case list pages filter by
-- them in the future. Cheap and drop-safe.
create index if not exists vehicles_vehicle_type_id_idx
  on public.vehicles(vehicle_type_id)
  where vehicle_type_id is not null;

create index if not exists vehicles_manufacturer_id_idx
  on public.vehicles(manufacturer_id)
  where manufacturer_id is not null;
