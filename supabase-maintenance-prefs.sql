-- ═══════════════════════════════════════════════════════════════════════════
-- Maintenance reminder preferences + Repair types
--
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Design choice: the 74-item built-in catalog stays in code
-- (src/components/shared/MaintenanceCatalog.jsx) as the source of truth.
-- This table only stores per-user OVERRIDES of interval + a list of
-- user-defined CUSTOM types. The client merges the two at read time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. maintenance_reminder_prefs ─────────────────────────────────────────
-- One row per (user, catalog key) OR (user, custom_name).
--
-- For built-in types:
--   is_custom = false, catalog_key = 'רכב::טיפול שמן', custom_name = null
-- For user-added types:
--   is_custom = true,  catalog_key = null,            custom_name = 'טיפול אקזוטי'
--
-- A row only exists if the user has CHANGED something (override). If no row
-- exists for a given built-in catalog item, the client uses the catalog's
-- default interval as-is.

CREATE TABLE IF NOT EXISTS public.maintenance_reminder_prefs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_type              text,                    -- optional: limit custom item to a vehicle type
  catalog_key               text,                    -- 'vehicle_type::name' for built-in overrides
  custom_name               text,                    -- non-null for user-added items
  is_custom                 boolean NOT NULL DEFAULT false,
  enabled                   boolean NOT NULL DEFAULT true,
  interval_months           int CHECK (interval_months IS NULL OR (interval_months > 0 AND interval_months <= 120)),
  interval_km               int CHECK (interval_km IS NULL OR (interval_km > 0 AND interval_km <= 1000000)),
  remind_days_before        int NOT NULL DEFAULT 14 CHECK (remind_days_before >= 0 AND remind_days_before <= 365),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- Either override a built-in or define a custom type — never both nor neither.
  CONSTRAINT pref_shape CHECK (
    (is_custom = false AND catalog_key IS NOT NULL AND custom_name IS NULL) OR
    (is_custom = true  AND custom_name IS NOT NULL AND catalog_key IS NULL)
  ),

  -- One override per (user, catalog_key) for built-in items.
  -- Custom items rely on the (user, lower(custom_name)) uniqueness index below.
  CONSTRAINT pref_unique_builtin UNIQUE (user_id, catalog_key)
);

-- Case-insensitive uniqueness on custom names per user (Hebrew-safe).
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_prefs_custom_name_unique
  ON public.maintenance_reminder_prefs (user_id, lower(custom_name))
  WHERE is_custom = true;

CREATE INDEX IF NOT EXISTS maintenance_prefs_user_idx
  ON public.maintenance_reminder_prefs(user_id);

DROP TRIGGER IF EXISTS trg_maintenance_prefs_updated_at ON public.maintenance_reminder_prefs;
CREATE TRIGGER trg_maintenance_prefs_updated_at
  BEFORE UPDATE ON public.maintenance_reminder_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.maintenance_reminder_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maint_prefs_self_all ON public.maintenance_reminder_prefs;
CREATE POLICY maint_prefs_self_all ON public.maintenance_reminder_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── 2. repair_types ───────────────────────────────────────────────────────
-- Simpler than maintenance: users just keep a list of named repairs so
-- the quick-add dialog can offer them as suggestions. No recurring
-- reminders (the user explicitly said repairs don't need them).

CREATE TABLE IF NOT EXISTS public.repair_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on repair-type names per user.
CREATE UNIQUE INDEX IF NOT EXISTS repair_types_name_unique
  ON public.repair_types (user_id, lower(name));

CREATE INDEX IF NOT EXISTS repair_types_user_idx
  ON public.repair_types(user_id);

ALTER TABLE public.repair_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_types_self_all ON public.repair_types;
CREATE POLICY repair_types_self_all ON public.repair_types
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM maintenance_reminder_prefs;
-- SELECT count(*) FROM repair_types;
