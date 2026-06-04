-- ═══════════════════════════════════════════════════════════════════════════
-- Release announcement — admin-published "what's new" popup — 2026-06-04
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: the only "what's new" the app showed was a HARDCODED list inside the
-- daily "טוב שחזרת" WelcomePopup, which popped AUTOMATICALLY once per day with
-- stale, non-editable content. Product decision (Ofek, 2026-06-04):
--   • Kill the automatic daily popup.
--   • Replace it with an announcement the admin PUBLISHES manually, with free
--     text, shown to each user EXACTLY ONCE (client dedups by announcement id).
--
-- This migration is PURELY ADDITIVE:
--   • New RPC public.publish_release_announcement(title, body, clear).
--   • Stores the current announcement in app_config under the single key
--     'release_announcement' as jsonb { id, title, body, published_at }.
--   • No schema change, no change to existing rows/policies. Re-runnable.
--
-- The CLIENT reads app_config('release_announcement') directly (same as
-- useUpdateAvailable reads *_latest_version) and shows the popup once per id.
-- Publishing a NEW announcement mints a NEW id, so every user sees it once.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.publish_release_announcement(
  p_title text,
  p_body  text,
  p_clear boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_id text;
begin
  -- Admin only — same guard the version broadcast uses.
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- Clear: remove the announcement so the popup stops showing for everyone
  -- who hasn't seen it yet. Users who already dismissed it are unaffected.
  if p_clear then
    delete from public.app_config where key = 'release_announcement';
    return jsonb_build_object('ok', true, 'action', 'cleared');
  end if;

  -- A body is required; the title is optional (a default is shown client-side).
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'empty_body: announcement text is required';
  end if;

  -- A fresh id per publish guarantees the one-shot client dedup re-arms for
  -- every NEW announcement, even if the text is similar to a previous one.
  v_id := gen_random_uuid()::text;

  insert into public.app_config (key, value, updated_at)
  values (
    'release_announcement',
    jsonb_build_object(
      'id',           v_id,
      'title',        left(coalesce(btrim(p_title), ''), 120),
      'body',         left(btrim(p_body), 2000),
      'published_at', now()
    ),
    now()
  )
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'action', 'published', 'id', v_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.publish_release_announcement(text, text, boolean) TO authenticated;

-- Verify:
--   SELECT public.publish_release_announcement('בדיקה', 'טקסט לדוגמה', false);
--   SELECT value FROM public.app_config WHERE key = 'release_announcement';
--   SELECT public.publish_release_announcement('', '', true);  -- clear
