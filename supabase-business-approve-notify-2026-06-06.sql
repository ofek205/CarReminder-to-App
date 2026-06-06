-- ═══════════════════════════════════════════════════════════════════════════
-- Business approval → notify the requester — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- When an admin approves a business-workspace request, the requester should
-- learn about it. This adds an in-app notification (bell) + native push to
-- approve_business_workspace_request by inserting an app_notifications row
-- (the existing app_notifications AFTER-INSERT trigger delivers the push).
--
-- The approval EMAIL is sent client-side by the admin panel (send-email is
-- JWT/user-callable, not cron-callable), so it is NOT added here.
--
-- ADDITIVE + SAFE to deploy now: approval is an admin-only action and the new
-- insert is best-effort wrapped so it can never roll back the approval.
-- The provisioning logic is byte-identical to the current function.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.approve_business_workspace_request(
  p_request_id uuid,
  p_review_note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  admin_uid uuid := auth.uid();
  req record;
  new_account_id uuid;
begin
  if admin_uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin() then
    raise exception 'forbidden_not_admin';
  end if;

  select * into req from public.business_workspace_requests where id = p_request_id;
  if req.id is null then raise exception 'request_not_found'; end if;
  if req.status <> 'pending' then raise exception 'request_already_resolved'; end if;

  -- Create workspace owned by the requesting user (NOT the admin).
  insert into public.accounts (owner_user_id, type, name, business_meta, created_via)
    values (req.requesting_user_id, 'business', req.requested_name, req.business_meta, 'business_create_approved')
    returning id into new_account_id;

  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_account_id, req.requesting_user_id, 'בעלים', 'פעיל', now());

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (new_account_id, admin_uid, 'workspace.create_approved', 'workspace', new_account_id,
     jsonb_build_object('name', req.requested_name, 'request_id', req.id, 'requested_by', req.requesting_user_id));

  update public.business_workspace_requests
     set status              = 'approved',
         reviewed_by         = admin_uid,
         reviewed_at         = now(),
         review_note         = nullif(trim(coalesce(p_review_note,'')), ''),
         created_account_id  = new_account_id
   where id = p_request_id;

  -- Notify the requester (bell + native push via the app_notifications
  -- AFTER-INSERT trigger). Best-effort: never let it roll back the approval.
  begin
    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      req.requesting_user_id,
      'business_approved',
      'החשבון העסקי אושר 🎉',
      req.requested_name || ' מוכן לשימוש. הקש כדי להיכנס לחשבון העסקי.',
      jsonb_build_object('account_id', new_account_id, 'name', req.requested_name)
    );
  exception when others then
    null;
  end;

  return new_account_id;
end;
$function$;

-- Verify:
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='approve_business_workspace_request';
