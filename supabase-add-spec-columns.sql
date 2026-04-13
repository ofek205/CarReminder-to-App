-- ═══════════════════════════════════════════════════════════════════════════
-- Add technical spec columns to vehicles table
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- קוד דגם (e.g., 939AXB11)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model_code text;

-- רמת גימור (e.g., CLASSICOPLUS)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS trim_level text;

-- מספר שלדה VIN (e.g., ZAR93900007252501)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin text;

-- קבוצת זיהום (e.g., 15)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS pollution_group text;

-- סיווג רכב: פרטי/מסחרי/אופנוע/משאית (from sug_degem)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_class text;

-- רמת אבזור בטיחותי
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS safety_rating text;

-- מרינה (for vessels)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS marina text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS marina_abroad boolean DEFAULT false;

-- מטפי כיבוי מרובים (JSON array)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fire_extinguishers jsonb;

-- תאריך עדכון ק"מ / שעות מנוע
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS km_update_date timestamptz;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS engine_hours_update_date timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- מפרט טכני מורחב — מאגר דגמי רכב (API שני)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS horsepower text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS engine_cc text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS drivetrain text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS total_weight text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS doors text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seats text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS airbags text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS body_type text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS country_of_origin text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS co2 text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS green_index text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tow_capacity text;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTE: All spec fields are text type — they store formatted values
-- like "125 כ"ס" or "1395 סמ"ק" ready for display.
-- No additional columns needed for motorcycles — they use the same fields.
-- ═══════════════════════════════════════════════════════════════════════════
