-- ═══════════════════════════════════════════════════════════════════
-- Add missing vehicle columns for vessels and off-road vehicles
-- ═══════════════════════════════════════════════════════════════════
-- HOW TO APPLY:
-- 1. Go to https://supabase.com/dashboard
-- 2. Select your project
-- 3. Go to SQL Editor
-- 4. Paste this and click Run
-- ═══════════════════════════════════════════════════════════════════

-- Vessel fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS flag_country TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS engine_manufacturer TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS pyrotechnics_expiry_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fire_extinguisher_expiry_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS life_raft_expiry_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_shipyard_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hours_since_shipyard INTEGER;

-- Off-road fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS offroad_equipment TEXT[];
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS offroad_usage_type TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_offroad_service_date DATE;
