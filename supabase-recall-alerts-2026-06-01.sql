-- ═══════════════════════════════════════════════════════════════════════════
-- Recall alerts — dedup table for proactive recall notifications — 2026-06-01
-- ═══════════════════════════════════════════════════════════════════════════
-- Phase B of recall integration. The dispatch-recall-alerts edge function
-- (daily cron) matches every saved vehicle's plate against the MoT open-recall
-- dataset and notifies the owner when a recall is open for their vehicle.
-- This table records WHICH (vehicle, recall) pairs were already notified, so
-- a vehicle that still hasn't done its recall isn't re-notified every day.
--
-- SAFETY: new isolated table, no change to existing tables. Service-role
-- writes only (the edge function); users may read their own rows. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vehicle_recall_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recall_id    text NOT NULL,
  defect       text,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  -- One notification per (vehicle, recall) — the dedup guarantee.
  UNIQUE (vehicle_id, recall_id)
);

CREATE INDEX IF NOT EXISTS idx_recall_alerts_user
  ON public.vehicle_recall_alerts(user_id, notified_at DESC);

ALTER TABLE public.vehicle_recall_alerts ENABLE ROW LEVEL SECURITY;

-- Users may read their own recall-alert history. INSERTs come from the edge
-- function via the service role (which bypasses RLS) — never from clients.
DROP POLICY IF EXISTS recall_alerts_select_own ON public.vehicle_recall_alerts;
CREATE POLICY recall_alerts_select_own
  ON public.vehicle_recall_alerts FOR SELECT
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT count(*) FROM public.vehicle_recall_alerts;
--   SELECT * FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='vehicle_recall_alerts';
-- ────────────────────────────────────────────────────────────────────
