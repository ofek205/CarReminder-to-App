-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-view-as-target-user-2026-07-24.sql
-- Make an admin view session identify a (USER, ACCOUNT) pair instead of just
-- an account.
--
-- THE DEFECT
--   admin_start_view took only p_account_id and derived the person from
--   accounts.owner_user_id (supabase-admin-view-as.sql:132). The session was
--   ACCOUNT-identified, but the question support actually asks is "what does
--   THIS PERSON see in THIS workspace". The pair (user=a manager, account=the
--   business they manage) could not be expressed at all.
--
--   The consequence was observed in production data. Because the workspace
--   switcher routes through admin_start_view during a live session, switching
--   workspaces silently RE-TARGETED the session at the new account's owner:
--
--     15:34:07 → 15:34:15   zvikanaftali   חשבון
--     15:34:15 → 15:34:54   nehemiya       נפתלי ניסן ובניו   <- person changed
--
--   The admin asked to see Zvika's business workspace and was handed the
--   owner's identity instead. Every ended_at equals the next started_at, which
--   is the signature of admin_start_view closing the prior row — that is how
--   these were identified as switches rather than deliberate entries.
--
-- WHAT ELSE THIS FIXES
--   Validation now happens BEFORE a session row exists, so the three cases
--   that used to open a session and then fail during token minting — with a
--   generic "try again" the operator could not act on — fail immediately with
--   a specific reason:
--
--     cannot_view_admin     admin-impersonate refuses admin targets by design
--                           (lateral privilege escalation with laundered
--                           blame). Entering view-as on one's OWN account hit
--                           exactly this, and the old code proceeded anyway:
--                           no token, everything running as the admin, banner
--                           naming the admin's own account. Four chained
--                           sessions on 2026-07-24 13:33-13:35 are that bug.
--     account_has_no_owner  owner_user_id became NULLABLE earlier today
--                           (supabase-admin-account-owner-2026-07-24.sql:48),
--                           so ownerless business workspaces are now a
--                           supported state — and an un-viewable one.
--     not_a_member          asking to view someone in a workspace they have no
--                           access to would render empty screens under a
--                           banner claiming otherwise.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION
--   p_user_id defaults to NULL, which reproduces the old behaviour exactly
--   (target = account owner). A client that still calls with two arguments
--   keeps working, so this file is safe to apply BEFORE deploying the app.
--
--   The old two-argument signature must be DROPPED, not left alongside:
--   PostgREST resolves overloads by argument name, and two candidates that
--   both accept {p_account_id, p_reason} make every call ambiguous
--   ("Could not choose the best candidate function"). One signature only.
--
-- DEPENDS ON: public.is_admin(), public.is_admin(uuid), public.admin_log(),
--             admin_view_sessions, accounts, account_members. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── admin_start_view ──────────────────────────────────────────────────────
-- Drop EVERY existing overload, not just the (uuid, text) one this repo knows
-- about. The repo is not a mirror of the database — admin_user_accounts, for
-- one, exists in the live schema and in no .sql file here — so hardcoding the
-- signature risks leaving an unknown overload in place and creating a second
-- candidate. PostgREST resolves by argument name and would then fail every
-- call with "Could not choose the best candidate function". Enumerating from
-- pg_proc drops whatever is actually there.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_start_view'
  loop
    execute format('drop function %s', r.sig);
    raise notice 'dropped %', r.sig;
  end loop;
end $$;

create or replace function public.admin_start_view(
  p_account_id uuid,
  p_reason     text default null,
  p_user_id    uuid default null    -- NULL ⇒ the account owner (old behaviour)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner       uuid;
  v_target      uuid;
  v_name        text;
  v_type        text;
  v_email       text;
  v_user_name   text;
  v_role        text;
  v_is_owner    boolean;
  v_is_member   boolean;
  v_expires     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select a.owner_user_id, a.name, a.type
    into v_owner, v_name, v_type
  from public.accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  -- ── Resolve WHO we are about to become ──────────────────────────────────
  v_target := coalesce(p_user_id, v_owner);

  if v_target is null then
    -- Ownerless workspace. Nobody to impersonate, so there is no coherent
    -- session to open. Caller should pick a member explicitly.
    raise exception 'account_has_no_owner' using errcode = 'P0002';
  end if;

  v_is_owner  := (v_owner is not null and v_target = v_owner);
  v_is_member := exists (
    select 1 from public.account_members am
     where am.account_id = p_account_id
       and am.user_id    = v_target
       and am.status     = 'פעיל'
  );

  if not (v_is_owner or v_is_member) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- ── Never view an admin ─────────────────────────────────────────────────
  -- admin-impersonate enforces this too (gate 3). Duplicated deliberately:
  -- catching it here means no session row is created, so the failure is one
  -- readable error instead of a half-entered session that dies at mint time.
  if public.is_admin(v_target) then
    raise exception 'cannot_view_admin' using errcode = '42501';
  end if;

  -- The role the TARGET actually holds here. Drives the client's affordances,
  -- so that viewing a driver looks like being a driver rather than an owner
  -- with buttons the server will refuse.
  select am.role into v_role
    from public.account_members am
   where am.account_id = p_account_id
     and am.user_id    = v_target
     and am.status     = 'פעיל'
   limit 1;
  if v_role is null and v_is_owner then
    v_role := 'בעלים';   -- owner without an explicit member row (legacy data)
  end if;

  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש'), email
    into v_user_name, v_email
    from auth.users where id = v_target;

  -- One active session at a time: close any still-open ones for this admin.
  update public.admin_view_sessions
     set ended_at = now()
   where admin_user_id = auth.uid()
     and ended_at is null;

  v_expires := now() + interval '30 minutes';

  insert into public.admin_view_sessions
    (admin_user_id, target_account_id, target_user_id, reason, expires_at)
  values
    (auth.uid(), p_account_id, v_target, p_reason, v_expires);

  perform public.admin_log(
    'view_start', 'account', p_account_id::text,
    jsonb_build_object(
      'target_user_id', v_target,
      'target_role',    coalesce(v_role, ''),
      -- Records that the caller named the person rather than inheriting the
      -- owner. Distinguishes "viewed the business" from "viewed Zvika inside
      -- the business" forever.
      'explicit_user',  p_user_id is not null,
      'reason',         coalesce(p_reason, '')
    )
  );

  return jsonb_build_object(
    'target_account_id', p_account_id,
    'target_user_id',    v_target,
    'target_name',       coalesce(v_name, ''),        -- the ACCOUNT's name
    'target_user_name',  coalesce(v_user_name, ''),   -- the PERSON's name
    'target_role',       coalesce(v_role, ''),
    'target_type',       coalesce(v_type, 'personal'),
    'owner_email',       coalesce(v_email, ''),
    'expires_at',        v_expires
  );
end;
$$;

grant execute on function public.admin_start_view(uuid, text, uuid) to authenticated;


-- ── admin_current_view ────────────────────────────────────────────────────
-- Same payload as admin_start_view, so a page reload restores the identical
-- state. Previously it omitted the role and the email: after a refresh the
-- client fell back to a hardcoded 'בעלים' and an empty email, which is how a
-- viewed driver silently became an owner just by pressing F5.
--
-- The role is RECOMPUTED rather than read from the session row: a support call
-- can outlive a role change, and the client should follow the current truth.
create or replace function public.admin_current_view()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_role      text;
  v_user_name text;
  v_email     text;
begin
  if not public.is_admin() then
    return null;
  end if;

  select s.target_account_id, s.target_user_id, s.expires_at,
         a.name as acc_name, a.type as acc_type, a.owner_user_id
    into r
  from public.admin_view_sessions s
  join public.accounts a on a.id = s.target_account_id
  where s.admin_user_id = auth.uid()
    and s.ended_at is null
    and s.expires_at > now()
  order by s.started_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select am.role into v_role
    from public.account_members am
   where am.account_id = r.target_account_id
     and am.user_id    = r.target_user_id
     and am.status     = 'פעיל'
   limit 1;
  if v_role is null and r.owner_user_id is not null
     and r.target_user_id = r.owner_user_id then
    v_role := 'בעלים';
  end if;

  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש'), email
    into v_user_name, v_email
    from auth.users where id = r.target_user_id;

  return jsonb_build_object(
    'target_account_id', r.target_account_id,
    'target_user_id',    r.target_user_id,
    'target_name',       coalesce(r.acc_name, ''),
    'target_user_name',  coalesce(v_user_name, ''),
    'target_role',       coalesce(v_role, ''),
    'target_type',       coalesce(r.acc_type, 'personal'),
    'owner_email',       coalesce(v_email, ''),
    'expires_at',        r.expires_at
  );
end;
$$;

grant execute on function public.admin_current_view() to authenticated;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════════
--   -- Exactly ONE admin_start_view, taking three arguments. More than one row
--   -- here means PostgREST cannot resolve the call and every entry fails.
--   select pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_start_view';
--   -- expect exactly: p_account_id uuid, p_reason text, p_user_id uuid
--
--   -- After a workspace switch during a live session, the PERSON must stay
--   -- fixed across the chain while only the ACCOUNT moves:
--   select s.started_at, tu.email as target_email, a.name as target_account
--     from public.admin_view_sessions s
--     left join auth.users      tu on tu.id = s.target_user_id
--     left join public.accounts a  on a.id  = s.target_account_id
--    order by s.started_at desc limit 5;
--
--   -- DRIFT CHECK — admin_user_accounts exists in the live DB but in NO .sql
--   -- file in this repo. Dump it and commit the result so the next person can
--   -- read it without a database connection:
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_user_accounts';
-- ═══════════════════════════════════════════════════════════════════════════
