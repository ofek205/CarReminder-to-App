-- ═══════════════════════════════════════════════════════════════════════════
-- Business-account request gate — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- Goal: EVERY business account goes through an admin-approved request (today
-- the FIRST one is free-created). The request form also collects vehicles
-- range, users range, phone and notes, and the admin gets a Telegram alert.
--
-- Two parts with DIFFERENT deploy timing:
--
--   PART A — request_business_workspace  ← DEPLOY NOW (backward-compatible)
--     • Removes the "must already own a business workspace" precondition so
--       the FIRST request is allowed too.
--     • Saves phone (from business_meta.phone) to user_profiles if missing.
--     • Fires an admin Telegram alert by inserting into admin_alerts (the
--       existing admin_alerts_after_insert trigger delivers it). Best-effort.
--     • Does NOT hard-require phone — that stays a CLIENT-side rule, so the
--       current production client (which doesn't send phone) keeps working.
--
--   PART B — create_business_workspace block  ← DEPLOY ONLY AT THE COORDINATED
--     PRODUCTION PROMOTION, together with the new client. Blocking it now
--     would break the CURRENT prod client's free-create call.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- PART A — deploy now
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_business_workspace(
  p_name text,
  p_business_meta jsonb DEFAULT NULL::jsonb,
  p_reason text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  uid        uuid := auth.uid();
  new_id     uuid;
  clean_name text;
  v_phone    text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then raise exception 'name_required'; end if;
  if char_length(clean_name) > 120 then raise exception 'name_too_long'; end if;

  -- (Removed the no_existing_business_workspace precondition: ALL business
  -- accounts now go through the request flow, including the first.)

  -- No duplicate pending requests.
  if exists (
    select 1 from public.business_workspace_requests
     where requesting_user_id = uid and status = 'pending'
  ) then
    raise exception 'pending_request_exists';
  end if;

  insert into public.business_workspace_requests
    (requesting_user_id, requested_name, business_meta, reason, status)
  values
    (uid, clean_name, p_business_meta, nullif(trim(coalesce(p_reason,'')), ''), 'pending')
  returning id into new_id;

  -- Persist phone to the profile if the form supplied one and the profile
  -- doesn't already have it (the request form requires a phone client-side).
  v_phone := nullif(trim(coalesce(p_business_meta->>'phone', '')), '');
  if v_phone is not null then
    update public.user_profiles
       set phone = v_phone
     where user_id = uid and (phone is null or btrim(phone) = '');
  end if;

  -- Admin Telegram alert via the existing admin_alerts → trigger pipeline.
  -- Best-effort: never let the alert failure roll back the request.
  begin
    insert into public.admin_alerts (kind, severity, title, message, context)
    values (
      'business_request',
      'info',
      'בקשת חשבון עסקי חדשה',
      clean_name
        || ' · טלפון: ' || coalesce(v_phone, 'לא צוין')
        || ' · רכבים: ' || coalesce(p_business_meta->>'vehicles_range', '?')
        || ' · משתמשים: ' || coalesce(p_business_meta->>'users_range', '?'),
      jsonb_build_object(
        'request_id',     new_id,
        'user_id',        uid,
        'name',           clean_name,
        'phone',          v_phone,
        'vehicles_range', p_business_meta->>'vehicles_range',
        'users_range',    p_business_meta->>'users_range',
        'business_id',    p_business_meta->>'business_id',
        'contact_email',  p_business_meta->>'contact_email',
        'notes',          nullif(trim(coalesce(p_reason,'')), '')
      )
    );
  exception when others then
    null; -- alert is best-effort; the request is already saved
  end;

  return new_id;
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────────
-- PART B — DEPLOY ONLY AT THE COORDINATED PRODUCTION PROMOTION (NOT NOW).
-- Blocks self-service business creation for non-admins, so the ONLY way to
-- get a business account is the admin-approved request. Admins keep the
-- bypass (support cases). Approval still creates the account via
-- approve_business_workspace_request (unaffected).
-- ─────────────────────────────────────────────────────────────────────────
/*
CREATE OR REPLACE FUNCTION public.create_business_workspace(
  p_name text,
  p_business_meta jsonb DEFAULT NULL::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  new_id uuid;
  clean_name text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  -- Self-service business creation is disabled. All business accounts must
  -- go through request_business_workspace + admin approval. Admins bypass.
  if not public.is_admin() then
    raise exception 'approval_required';
  end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then raise exception 'name_required'; end if;
  if char_length(clean_name) > 120 then raise exception 'name_too_long'; end if;

  insert into public.accounts (owner_user_id, type, name, business_meta, created_via)
    values (uid, 'business', clean_name, p_business_meta, 'business_create')
    returning id into new_id;
  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_id, uid, 'בעלים', 'פעיל', now());
  insert into public.workspace_audit_log (account_id, actor_user_id, action, target_kind, target_id, payload)
    values (new_id, uid, 'workspace.create', 'workspace', new_id,
            jsonb_build_object('name', clean_name, 'business_meta', p_business_meta));
  return new_id;
end;
$function$;
*/

-- Verify Part A:
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='request_business_workspace';
