-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-push-send-log.sql — per-token push outcome log
--
-- WHY: The `dispatch-push` Edge Function returns {sent, failed, pruned,
-- errors} in the HTTP response but does NOT persist that data. After
-- the call returns, there is no record of:
--   • Which user got which push at which time
--   • Why a particular push failed (token stale? FCM rate limit?)
--   • Whether push delivery rate is degrading over time
--
-- The audit (Phase 1 observability) flagged this as the #11 critical
-- gap. The frontend already has email_send_log + email_events for
-- email observability; this gives push parity.
--
-- Each row = one push attempt to one device token.
--   • status='sent'   — FCM/APNs accepted the push (≠ delivered to device)
--   • status='failed' — FCM/APNs rejected the call
--   • status='stale'  — token marked stale, pruned from device_tokens
--   • error           — short failure reason (truncated to 500ch)
--   • notif_id        — links to the app_notifications row that triggered
--                       this push (when applicable; null for ad-hoc tests)
--
-- The Edge Function writes via service-role (RLS bypassed) using the
-- batch insert pattern. Admins read via is_admin() policy.
--
-- Re-runnable. Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.push_send_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('android','ios')),
  token_prefix  text NOT NULL,                              -- first 12 chars of token (privacy)
  title         text,
  body          text,
  status        text NOT NULL CHECK (status IN ('sent','failed','stale')),
  error         text,
  notif_id      uuid,                                       -- links to app_notifications.id when applicable
  sent_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_send_log IS
'Per-token push outcome log. One row per push attempt. Mirrors email_send_log for the push channel — no parity gap with email observability.';

CREATE INDEX IF NOT EXISTS push_send_log_user_idx       ON public.push_send_log (user_id);
CREATE INDEX IF NOT EXISTS push_send_log_sent_at_idx    ON public.push_send_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS push_send_log_status_idx     ON public.push_send_log (status);
CREATE INDEX IF NOT EXISTS push_send_log_notif_id_idx   ON public.push_send_log (notif_id) WHERE notif_id IS NOT NULL;

ALTER TABLE public.push_send_log ENABLE ROW LEVEL SECURITY;

-- Service role can do anything (used by dispatch-push function via SUPABASE_SERVICE_ROLE_KEY).
-- Admin reads via is_admin() RPC. Regular users can read their OWN push log
-- (useful for "did my push arrive?" support flows).
DROP POLICY IF EXISTS push_send_log_admin_read ON public.push_send_log;
CREATE POLICY push_send_log_admin_read ON public.push_send_log
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS push_send_log_self_read ON public.push_send_log;
CREATE POLICY push_send_log_self_read ON public.push_send_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════
-- admin_push_stats(p_days int DEFAULT 7) — aggregate stats for AdminHealth
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_push_stats(integer);

CREATE FUNCTION public.admin_push_stats(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'window_days', p_days,
    'total',  COUNT(*),
    'sent',   COUNT(*) FILTER (WHERE status = 'sent'),
    'failed', COUNT(*) FILTER (WHERE status = 'failed'),
    'stale',  COUNT(*) FILTER (WHERE status = 'stale'),
    'success_rate_pct',
      CASE WHEN COUNT(*) = 0 THEN 0
           ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'sent') / COUNT(*), 1)
      END,
    'by_platform', (
      SELECT jsonb_object_agg(platform, cnt)
      FROM (
        SELECT platform, COUNT(*) AS cnt
        FROM public.push_send_log
        WHERE sent_at >= now() - (p_days || ' days')::interval
        GROUP BY platform
      ) p
    ),
    'top_errors', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('error', error, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT LEFT(error, 120) AS error, COUNT(*) AS cnt
        FROM public.push_send_log
        WHERE sent_at >= now() - (p_days || ' days')::interval
          AND status = 'failed'
          AND error IS NOT NULL
        GROUP BY LEFT(error, 120)
        ORDER BY COUNT(*) DESC
        LIMIT 10
      ) e
    )
  )
  INTO v_result
  FROM public.push_send_log
  WHERE sent_at >= now() - (p_days || ' days')::interval;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_push_stats(integer) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS:
--   SELECT public.admin_push_stats(7);
--   SELECT * FROM public.push_send_log ORDER BY sent_at DESC LIMIT 10;
-- ═══════════════════════════════════════════════════════════════════════════
