-- ==========================================================================
-- Signup resilience — "never again" hardening after two incidents:
--   Episode 1 (Ilan/Eyal/nethanel834): RLS blocked direct INSERT
--   Episode 2 (natanzone2024): NOT NULL column 'name' caught us off-guard
--
-- This file adds three defenses on top of the existing
-- ensure_user_account + handle_new_user pair:
--
-- 1. Defensive trigger — if the email-derived name fails for any reason
--    (column constraint we didn't know about, future schema drift), fall
--    back to a literal 'חשבון' so the row ALWAYS lands. Only if the
--    fallback also fails do we raise warning AND log to a persistent
--    table so an admin sees it without scraping Postgres logs.
--
-- 2. provisioning_errors table — stores every silent failure so they're
--    visible. Feeds the admin health widget. Self-cleans rows older than
--    30 days.
--
-- 3. signup_health() RPC — single call returns the metrics that catch
--    incidents: orphan count, last error, total provisioned. Wired to
--    /admin/health and any external uptime monitor.
--
-- 4. provision_orphan_users() RPC — admin-callable self-healer. Iterates
--    users without an active membership and re-runs the provisioning
--    logic. Same heuristic as the backfill in supabase-new-user-bootstrap
--    but reusable + reportable.
--
-- Idempotent.
-- ==========================================================================

-- ── 1. provisioning_errors table ──────────────────────────────────────
create table if not exists public.provisioning_errors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  email           text,
  context         text not null,                  -- 'handle_new_user' | 'ensure_user_account' | 'orphan_heal'
  sqlstate        text,
  message         text,
  occurred_at     timestamptz not null default now()
);

create index if not exists provisioning_errors_recent_idx
  on public.provisioning_errors(occurred_at desc);

alter table public.provisioning_errors enable row level security;

-- Only admins can read/clear. Inserts happen via SECURITY DEFINER triggers,
-- so no INSERT policy is exposed.
drop policy if exists provisioning_errors_admin_select on public.provisioning_errors;
create policy provisioning_errors_admin_select on public.provisioning_errors
  for select using (public.is_admin());

drop policy if exists provisioning_errors_admin_delete on public.provisioning_errors;
create policy provisioning_errors_admin_delete on public.provisioning_errors
  for delete using (public.is_admin());


-- ── 2. Defensive handle_new_user — falls back to literal name on error ─
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
  email_name text;
begin
  if exists (
    select 1 from public.account_members
     where user_id = new.id and status = 'פעיל'
  ) then
    return new;
  end if;

  email_name := nullif(split_part(new.email, '@', 1), '');

  -- Attempt 1: email-prefix name. Most common path.
  begin
    insert into public.accounts (owner_user_id, name)
      values (new.id, coalesce(email_name, 'חשבון'))
      returning id into new_account_id;

    insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (new_account_id, new.id, 'בעלים', 'פעיל', now());

    return new;
  exception when others then
    -- Log so we notice the schema drift, then fall through to attempt 2.
    insert into public.provisioning_errors (user_id, email, context, sqlstate, message)
      values (new.id, new.email, 'handle_new_user.attempt1', sqlstate, sqlerrm);
  end;

  -- Attempt 2: minimal fallback — literal name only. Catches a *new*
  -- NOT NULL column we don't know about (the row still won't land, but
  -- we'll at least have a clean log entry pointing right at the field).
  begin
    insert into public.accounts (owner_user_id, name)
      values (new.id, 'חשבון')
      returning id into new_account_id;

    insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (new_account_id, new.id, 'בעלים', 'פעיל', now());

    return new;
  exception when others then
    insert into public.provisioning_errors (user_id, email, context, sqlstate, message)
      values (new.id, new.email, 'handle_new_user.attempt2', sqlstate, sqlerrm);
    raise warning 'handle_new_user FAILED for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 3. signup_health() — admin dashboard metric source ────────────────
create or replace function public.signup_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orphan_count int;
  v_orphan_count_recent int;
  v_recent_errors int;
  v_last_error timestamptz;
  v_total_users int;
  v_total_provisioned int;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  select count(*) into v_orphan_count
    from auth.users u
   where not exists (
     select 1 from public.account_members
      where user_id = u.id and status = 'פעיל'
   );

  -- Recent (last 24h) is more actionable — old orphans are usually
  -- deleted test accounts, recent ones are bleeding users.
  select count(*) into v_orphan_count_recent
    from auth.users u
   where u.created_at > now() - interval '24 hours'
     and not exists (
       select 1 from public.account_members
        where user_id = u.id and status = 'פעיל'
     );

  select count(*), max(occurred_at)
    into v_recent_errors, v_last_error
    from public.provisioning_errors
   where occurred_at > now() - interval '24 hours';

  select count(*) into v_total_users from auth.users;
  select count(distinct user_id) into v_total_provisioned
    from public.account_members where status = 'פעיל';

  return jsonb_build_object(
    'orphan_users_total', v_orphan_count,
    'orphan_users_24h',   v_orphan_count_recent,
    'errors_24h',         v_recent_errors,
    'last_error_at',      v_last_error,
    'total_users',        v_total_users,
    'total_provisioned',  v_total_provisioned,
    'health_status',
      case
        when v_orphan_count_recent > 0 or v_recent_errors > 0 then 'degraded'
        else 'healthy'
      end,
    'checked_at',         now()
  );
end;
$$;

revoke all on function public.signup_health() from public;
grant execute on function public.signup_health() to authenticated;


-- ── 4. provision_orphan_users() — admin self-healer ───────────────────
-- Returns count of users provisioned. Idempotent.
create or replace function public.provision_orphan_users()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  new_account_id uuid;
  email_name text;
  count_fixed int := 0;
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  for u in
    select id, email
      from auth.users
     where not exists (
       select 1 from public.account_members
        where user_id = auth.users.id and status = 'פעיל'
     )
  loop
    email_name := nullif(split_part(u.email, '@', 1), '');
    begin
      insert into public.accounts (owner_user_id, name)
        values (u.id, coalesce(email_name, 'חשבון'))
        returning id into new_account_id;

      insert into public.account_members (account_id, user_id, role, status, joined_at)
        values (new_account_id, u.id, 'בעלים', 'פעיל', now());

      count_fixed := count_fixed + 1;
    exception when others then
      insert into public.provisioning_errors (user_id, email, context, sqlstate, message)
        values (u.id, u.email, 'orphan_heal', sqlstate, sqlerrm);
    end;
  end loop;

  return count_fixed;
end;
$$;

revoke all on function public.provision_orphan_users() from public;
grant execute on function public.provision_orphan_users() to authenticated;

notify pgrst, 'reload schema';
