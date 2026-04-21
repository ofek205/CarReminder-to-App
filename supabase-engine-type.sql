-- ==========================================================================
-- Adds engine_type to vehicles so we can branch outboard vs inboard
-- engine checklists. Free-form text (no strict constraint) so users can
-- record uncommon setups too.
-- ==========================================================================

alter table public.vehicles add column if not exists engine_type text;

-- Optional helpful index when filtering vessels by engine type.
create index if not exists vehicles_engine_type_idx
  on public.vehicles(engine_type)
  where engine_type is not null;
