-- ═══════════════════════════════════════════════════════════════════════════
-- Email Center — Phase 3 (Events & Version History)
--
-- Adds:
--   • email_events                — per-message events from the Resend
--                                    webhook (delivered/opened/clicked/
--                                    bounced/complained/etc.)
--   • email_template_snapshot()   — trigger that auto-saves a version
--                                    row on every email_templates UPDATE.
--   • email_stats_recent()        — admin RPC for the 30-day dashboard.
--   • ingest_resend_event()       — SECURITY DEFINER write path used by
--                                    the resend-webhook Edge Function.
--
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Events table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_log_id       uuid REFERENCES public.email_send_log(id) ON DELETE SET NULL,
  message_id        text,                       -- Resend message id
  event_type        text NOT NULL
                      CHECK (event_type IN (
                        'sent', 'delivered', 'delivery_delayed',
                        'bounced', 'complained',
                        'opened', 'clicked',
                        'failed', 'other'
                      )),
  recipient_email   text,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_events_send_log_idx
  ON public.email_events(send_log_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS email_events_message_idx
  ON public.email_events(message_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS email_events_type_recent_idx
  ON public.email_events(event_type, occurred_at DESC);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

-- Only admins can read events. The webhook writes through a SECURITY
-- DEFINER function (below), so it doesn't need an INSERT policy.
DROP POLICY IF EXISTS "admins read events" ON public.email_events;
CREATE POLICY "admins read events" ON public.email_events
  FOR SELECT TO authenticated
  USING (public.is_current_user_admin());


-- ── Auto-snapshot trigger on email_templates ──────────────────────────────
-- Every UPDATE of email_templates writes a row to email_template_versions
-- with the PREVIOUS state. This gives the admin a rollback path without
-- needing to remember to click "save as version".

CREATE OR REPLACE FUNCTION public.email_template_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only snapshot if content actually changed (ignore pure metadata updates).
  IF (OLD.subject     IS DISTINCT FROM NEW.subject)      OR
     (OLD.preheader   IS DISTINCT FROM NEW.preheader)    OR
     (OLD.title       IS DISTINCT FROM NEW.title)        OR
     (OLD.body_html   IS DISTINCT FROM NEW.body_html)    OR
     (OLD.cta_label   IS DISTINCT FROM NEW.cta_label)    OR
     (OLD.cta_url     IS DISTINCT FROM NEW.cta_url)      OR
     (OLD.footer_note IS DISTINCT FROM NEW.footer_note)  OR
     (OLD.from_name   IS DISTINCT FROM NEW.from_name)    OR
     (OLD.from_email  IS DISTINCT FROM NEW.from_email)   OR
     (OLD.reply_to    IS DISTINCT FROM NEW.reply_to)     OR
     (OLD.variables   IS DISTINCT FROM NEW.variables)
  THEN
    INSERT INTO public.email_template_versions (template_id, snapshot, created_by)
    VALUES (
      OLD.id,
      to_jsonb(OLD.*),
      NEW.updated_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_templates_snapshot ON public.email_templates;
CREATE TRIGGER trg_email_templates_snapshot
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.email_template_snapshot();


-- ── Stats RPC for the 30-day dashboard ────────────────────────────────────
-- Counts key metrics across the rolling 30-day window. Admin-only.

DROP FUNCTION IF EXISTS public.email_stats_recent(int);

CREATE FUNCTION public.email_stats_recent(p_days int DEFAULT 30)
RETURNS TABLE (
  sent       bigint,
  delivered  bigint,
  opened     bigint,
  clicked    bigint,
  bounced    bigint,
  complained bigint,
  failed     bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH window_log AS (
    SELECT id, message_id, status
      FROM public.email_send_log
     WHERE sent_at > now() - (p_days || ' days')::interval
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'sent')                                             AS sent,
    (SELECT COUNT(DISTINCT wl.id) FROM window_log wl
        JOIN public.email_events ev ON ev.send_log_id = wl.id WHERE ev.event_type = 'delivered')   AS delivered,
    (SELECT COUNT(DISTINCT wl.id) FROM window_log wl
        JOIN public.email_events ev ON ev.send_log_id = wl.id WHERE ev.event_type = 'opened')      AS opened,
    (SELECT COUNT(DISTINCT wl.id) FROM window_log wl
        JOIN public.email_events ev ON ev.send_log_id = wl.id WHERE ev.event_type = 'clicked')     AS clicked,
    (SELECT COUNT(DISTINCT wl.id) FROM window_log wl
        JOIN public.email_events ev ON ev.send_log_id = wl.id WHERE ev.event_type = 'bounced')     AS bounced,
    (SELECT COUNT(DISTINCT wl.id) FROM window_log wl
        JOIN public.email_events ev ON ev.send_log_id = wl.id WHERE ev.event_type = 'complained')  AS complained,
    COUNT(*) FILTER (WHERE status = 'failed')                                           AS failed
  FROM window_log;
$$;

GRANT EXECUTE ON FUNCTION public.email_stats_recent(int) TO authenticated;


-- ── Webhook ingest RPC ────────────────────────────────────────────────────
-- Called by the resend-webhook Edge Function. SECURITY DEFINER so the
-- webhook (which calls with service role anyway) stays future-proof if we
-- later tighten the RLS on email_events.
--
-- Also automatically updates email_send_log.status when a terminal event
-- arrives (bounced / complained → failed). 'delivered' is left as 'sent'
-- because send_log.status is about dispatch outcome, and "events" is the
-- richer view.

DROP FUNCTION IF EXISTS public.ingest_resend_event(text, text, text, timestamptz, jsonb);

CREATE FUNCTION public.ingest_resend_event(
  p_event_type      text,
  p_message_id      text,
  p_recipient       text DEFAULT NULL,
  p_occurred_at     timestamptz DEFAULT now(),
  p_raw             jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_send_log_id uuid;
  v_event_id    uuid;
  v_type        text;
BEGIN
  -- Normalise Resend's `email.delivered` → `delivered`, etc.
  v_type := regexp_replace(COALESCE(p_event_type, ''), '^email\.', '');

  -- Coerce to our allowed set; anything unknown lands as 'other' so the
  -- raw payload is still kept.
  IF v_type NOT IN ('sent','delivered','delivery_delayed','bounced','complained','opened','clicked','failed') THEN
    v_type := 'other';
  END IF;

  -- Link to the send_log row if we can find it by message_id.
  SELECT id INTO v_send_log_id
    FROM public.email_send_log
   WHERE message_id = p_message_id
   ORDER BY sent_at DESC
   LIMIT 1;

  INSERT INTO public.email_events
    (send_log_id, message_id, event_type, recipient_email, occurred_at, raw)
  VALUES
    (v_send_log_id, p_message_id, v_type, p_recipient, p_occurred_at, p_raw)
  RETURNING id INTO v_event_id;

  -- Promote send_log.status for terminal events.
  IF v_send_log_id IS NOT NULL AND v_type IN ('bounced','complained','failed') THEN
    UPDATE public.email_send_log
       SET status = 'failed',
           error  = COALESCE(error, v_type)
     WHERE id = v_send_log_id;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_resend_event(text, text, text, timestamptz, jsonb) TO service_role, authenticated;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT * FROM public.email_events ORDER BY occurred_at DESC LIMIT 10;
-- SELECT * FROM public.email_stats_recent(30);
-- SELECT COUNT(*) FROM public.email_template_versions;
