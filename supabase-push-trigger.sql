-- ═══════════════════════════════════════════════════════════════════════════
-- Push Notifications — server-side fan-out via DB trigger (commit 4/4)
--
-- Architecture decision (2026-05-13): we chose Option A — a single AFTER
-- INSERT trigger on `app_notifications` that calls the `dispatch-push`
-- Edge Function via pg_net. This way EVERY notification flow that
-- already inserts into app_notifications (vehicle_share, task_assigned,
-- test_renewed, community_comment, …) automatically gets a Push
-- notification on the user's native device, with zero changes to the
-- ~8 SECURITY DEFINER RPCs that produce those rows today.
--
-- Why a trigger and not client-side `supabase.functions.invoke('dispatch-push')`?
--   1. dispatch-push requires either SUPABASE_SERVICE_ROLE_KEY or
--      DISPATCH_SECRET to authenticate. Neither belongs in the browser
--      bundle — service role is god-mode, and DISPATCH_SECRET would leak
--      to every visitor.
--   2. app_notifications itself has NO INSERT policy for client roles —
--      every row already flows through a SECURITY DEFINER RPC. The
--      trigger sits at the same trust boundary, so it inherits the
--      existing authorization model.
--   3. One place to maintain instead of N+1 invoke() calls scattered
--      across the codebase. New notification types get push for free.
--
-- Prerequisites:
--   - pg_net extension enabled (default on Supabase).
--   - Supabase Vault enabled (default on Supabase).
--   - A vault secret named 'dispatch_secret' with the DISPATCH_SECRET
--     value already set on the dispatch-push Edge Function. The
--     migration creates the secret container; the actual value is
--     pasted in once by the operator (see "ONE-TIME SETUP" below).
--
-- ONE-TIME SETUP (run by the operator AFTER applying this migration):
--   1. In Supabase SQL Editor, run:
--        select vault.create_secret(
--          '<paste the DISPATCH_SECRET value here>',
--          'dispatch_secret',
--          'Shared secret for the app_notifications → dispatch-push trigger'
--        );
--   2. Verify with:
--        select name, length(decrypted_secret) > 0 as has_value
--        from vault.decrypted_secrets where name = 'dispatch_secret';
--      Expected: name=dispatch_secret, has_value=true.
--
-- Safety:
--   - The trigger is fire-and-forget (net.http_post returns immediately).
--     If dispatch-push is down, the bell notification still works.
--   - We do NOT block app_notifications INSERT on push success. Push is
--     a best-effort delivery channel — the canonical source of truth is
--     the app_notifications row + the realtime bell subscription.
--   - We skip the http_post when the user has no device tokens (cheap
--     existence check) so we don't burn pg_net request quotas on the
--     free-tier user majority who never installed the native app.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. notify_community_comment — SECURITY DEFINER wrapper
-- ───────────────────────────────────────────────────────────────────────────
-- CommentSection.jsx used to call supabase.from('app_notifications').insert
-- directly, but app_notifications has no INSERT policy for client roles,
-- so that call silently failed (and the try/catch swallowed the error).
-- This RPC is the proper path: validates caller, verifies the post exists
-- with the claimed owner, then INSERTs. The AFTER INSERT trigger below
-- then fans out the push automatically.
create or replace function public.notify_community_comment(
  p_post_id        uuid,
  p_commenter_name text,
  p_body_snippet   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id    uuid := auth.uid();
  v_post_owner uuid;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Look up the post owner under elevated privileges. We can't trust a
  -- caller-supplied owner_id because a malicious client could push spam
  -- to any user by lying about which post they commented on.
  select user_id into v_post_owner
  from public.community_posts
  where id = p_post_id;

  if v_post_owner is null then
    raise exception 'post_not_found';
  end if;

  -- Don't notify yourself when you comment on your own post.
  if caller_id = v_post_owner then
    return;
  end if;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    v_post_owner,
    'community_comment',
    coalesce(p_commenter_name, 'מישהו') || ' הגיב/ה על הפוסט שלך',
    coalesce(left(p_body_snippet, 120), ''),
    jsonb_build_object(
      'post_id',         p_post_id,
      'commenter_name',  coalesce(p_commenter_name, ''),
      'type',            'community_comment'
    )
  );
end;
$$;

revoke all on function public.notify_community_comment(uuid, text, text) from public;
grant execute on function public.notify_community_comment(uuid, text, text) to authenticated;

comment on function public.notify_community_comment(uuid, text, text)
  is 'Insert a community_comment notification for the post owner. Verifies the post exists; refuses self-notifications.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Trigger fan-out — AFTER INSERT on app_notifications
-- ───────────────────────────────────────────────────────────────────────────
-- Calls the dispatch-push Edge Function via pg_net. Fire-and-forget; the
-- INSERT is not rolled back if the HTTP call fails (pg_net is async).
--
-- We skip the call entirely when the recipient has zero device tokens —
-- there's no point in burning pg_net quota for a user who hasn't installed
-- the native app. The query is a cheap index lookup (user_id is indexed).
create or replace function public.tg_app_notifications_dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_secret  text;
  v_has_dev boolean;
  v_url     text := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/dispatch-push';
begin
  -- Cheap exit: no device tokens → no push possible.
  select exists (
    select 1 from public.device_tokens where user_id = new.user_id
  ) into v_has_dev;

  if not v_has_dev then
    return new;
  end if;

  -- Pull the shared secret from Vault. If it's missing we log a notice
  -- and return — better than throwing, because we don't want to block
  -- the bell notification path on push misconfiguration.
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'dispatch_secret'
  limit 1;

  if v_secret is null or length(v_secret) = 0 then
    raise notice 'dispatch_secret vault entry missing — push skipped for notif %', new.id;
    return new;
  end if;

  -- Fire-and-forget. pg_net puts the request on its async queue and
  -- the trigger returns immediately. Failures are visible in the
  -- net._http_response table for debugging.
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type',      'application/json',
      'x-dispatch-secret', v_secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'title',   new.title,
      'body',    new.body,
      'data',    coalesce(new.data, '{}'::jsonb) || jsonb_build_object('type', new.type)
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_app_notifications_dispatch_push on public.app_notifications;
create trigger trg_app_notifications_dispatch_push
  after insert on public.app_notifications
  for each row
  execute function public.tg_app_notifications_dispatch_push();

comment on function public.tg_app_notifications_dispatch_push()
  is 'Fire-and-forget pg_net call to dispatch-push Edge Function after every app_notifications INSERT. Skips users with no device tokens.';
