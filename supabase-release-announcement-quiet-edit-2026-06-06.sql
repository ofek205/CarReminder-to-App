-- ═══════════════════════════════════════════════════════════════════════════
-- Release announcement — add "quiet edit" (keep id) — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: publish_release_announcement always minted a NEW uuid, so editing a
-- live announcement (even a one-character typo fix) re-showed the popup to
-- EVERY user who had already dismissed it. Add p_keep_id: when true, reuse the
-- current announcement's id so dismissals persist (a silent edit). Default
-- false preserves the original "publish = show everyone once" behaviour.
--
-- Re-runnable. Drops the old 3-arg signature first so the 4-arg version
-- doesn't create an ambiguous overload.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.publish_release_announcement(text, text, boolean);

CREATE OR REPLACE FUNCTION public.publish_release_announcement(
  p_title   text,
  p_body    text,
  p_clear   boolean DEFAULT false,
  p_keep_id boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_id text;
begin
  -- Admin only — same guard as before.
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- Clear: stop showing the announcement to anyone who hasn't seen it yet.
  if p_clear then
    delete from public.app_config where key = 'release_announcement';
    return jsonb_build_object('ok', true, 'action', 'cleared');
  end if;

  if coalesce(btrim(p_body), '') = '' then
    raise exception 'empty_body: announcement text is required';
  end if;

  -- Quiet edit: reuse the CURRENT announcement id so users who already
  -- dismissed it are NOT re-shown. Falls back to a fresh id if none exists.
  if p_keep_id then
    select value->>'id' into v_id from public.app_config where key = 'release_announcement';
  end if;
  if v_id is null or v_id = '' then
    v_id := gen_random_uuid()::text;
  end if;

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

  return jsonb_build_object('ok', true,
    'action', case when p_keep_id then 'edited' else 'published' end,
    'id', v_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.publish_release_announcement(text, text, boolean, boolean) TO authenticated;

-- Verify:
--   SELECT public.publish_release_announcement('כותרת', 'טקסט', false, false); -- new, re-shows
--   SELECT public.publish_release_announcement('כותרת', 'טקסט מתוקן', false, true); -- quiet edit
--   SELECT value FROM public.app_config WHERE key = 'release_announcement';
