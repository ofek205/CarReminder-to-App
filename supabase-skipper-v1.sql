-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Skipper Assistant — V1 schema
--
-- Adds:
--   • Boat-attribute columns on vehicles (has_engine, engine_type, has_vhf,
--     has_sails, has_bilge_pump, has_generator, water_type). Drive the
--     attribute-based checklist filtering in the client engine.
--   • outings — a planned / in-progress / completed trip. Everything
--     (pre-check, post-check, outing log) hangs off this container.
--   • checklist_runs — a concrete execution of a checklist (pre or post)
--     for a specific outing. items snapshot is jsonb so template changes
--     never mutate historical runs.
--
-- Tasks + vessel_issues stay as-is per product decision.
-- Failed checklist items write into the existing vessel_issues table
-- with a marker in metadata/description — no new table needed.
--
-- Run ONCE in Supabase Dashboard → SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Boat-attribute columns on vehicles ─────────────────────────────────

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS has_engine       boolean,
  ADD COLUMN IF NOT EXISTS engine_type      text,        -- inboard|outboard|twin|none
  ADD COLUMN IF NOT EXISTS has_sails        boolean,
  ADD COLUMN IF NOT EXISTS has_vhf          boolean,
  ADD COLUMN IF NOT EXISTS has_bilge_pump   boolean,
  ADD COLUMN IF NOT EXISTS has_generator    boolean,
  ADD COLUMN IF NOT EXISTS has_electric_anchor boolean,
  ADD COLUMN IF NOT EXISTS water_type       text;        -- sea|fresh|both


-- ── 2. outings ────────────────────────────────────────────────────────────
-- A planned / in-progress / completed trip. Single row per outing.

CREATE TABLE IF NOT EXISTS public.outings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  vehicle_id           uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

  name                 text,                    -- "יציאה לאילת"
  trip_type            text NOT NULL DEFAULT 'short'
                        CHECK (trip_type IN ('short','long','fishing','family','night','unknown')),
  status               text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','in_progress','completed','cancelled')),

  planned_at           timestamptz,
  started_at           timestamptz,
  ended_at             timestamptz,

  notes                text,
  route                text,                    -- freeform "מרינה הרצליה → תל אביב"

  engine_hours_start   numeric,
  engine_hours_end     numeric,
  km_start             numeric,
  km_end               numeric,

  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outings_vehicle_idx    ON public.outings(vehicle_id, status);
CREATE INDEX IF NOT EXISTS outings_account_idx    ON public.outings(account_id, planned_at DESC);

DROP TRIGGER IF EXISTS trg_outings_updated_at ON public.outings;
CREATE TRIGGER trg_outings_updated_at
  BEFORE UPDATE ON public.outings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.outings ENABLE ROW LEVEL SECURITY;

-- Owners/members of the account can CRUD outings.
DROP POLICY IF EXISTS outings_account_read ON public.outings;
CREATE POLICY outings_account_read ON public.outings
  FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS outings_account_write ON public.outings;
CREATE POLICY outings_account_write ON public.outings
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS outings_account_update ON public.outings;
CREATE POLICY outings_account_update ON public.outings
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS outings_account_delete ON public.outings;
CREATE POLICY outings_account_delete ON public.outings
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );


-- ── 3. checklist_runs ─────────────────────────────────────────────────────
-- One row per pre/post execution. items jsonb is a snapshot — template
-- changes can't mutate historical runs.
--
-- items shape:
-- [
--   { section: 'safety', key: 'life_jackets', name: 'חגורות הצלה', state: 'passed'|'failed'|'skipped'|'pending', notes: null, failed_at: null },
--   ...
-- ]

CREATE TABLE IF NOT EXISTS public.checklist_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outing_id          uuid NOT NULL REFERENCES public.outings(id) ON DELETE CASCADE,
  vehicle_id         uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

  phase              text NOT NULL CHECK (phase IN ('pre','post')),
  template_key       text,               -- e.g. 'motorboat_pre_short' (reference to JS catalog)

  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,

  items              jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats              jsonb NOT NULL DEFAULT '{}'::jsonb,     -- {total, passed, failed, skipped}

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS checklist_runs_unique_phase
  ON public.checklist_runs(outing_id, phase);

CREATE INDEX IF NOT EXISTS checklist_runs_vehicle_idx
  ON public.checklist_runs(vehicle_id, completed_at DESC);

DROP TRIGGER IF EXISTS trg_checklist_runs_updated_at ON public.checklist_runs;
CREATE TRIGGER trg_checklist_runs_updated_at
  BEFORE UPDATE ON public.checklist_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.checklist_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_runs_account_all ON public.checklist_runs;
CREATE POLICY checklist_runs_account_all ON public.checklist_runs
  FOR ALL TO authenticated
  USING (
    outing_id IN (
      SELECT id FROM public.outings WHERE account_id IN (
        SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    outing_id IN (
      SELECT id FROM public.outings WHERE account_id IN (
        SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
      )
    )
  );


-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='vehicles' AND column_name LIKE 'has_%';
-- SELECT count(*) FROM public.outings;
-- SELECT count(*) FROM public.checklist_runs;
