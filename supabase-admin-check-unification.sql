-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Audit follow-up 2026-05-12 — unify admin checks to the email          ║
-- ║ allow-list (close residual privilege-escalation surface)              ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Problem:                                                              ║
-- ║   The earlier security commit closed the user_metadata.role privesc   ║
-- ║ in three Edge Functions, but a second pass found four more callsites   ║
-- ║ that still trusted that client-writable field:                        ║
-- ║                                                                       ║
-- ║   1. is_current_user_admin()  — old SECURITY DEFINER function used   ║
-- ║                                  by admin RPCs + RLS policies         ║
-- ║   2. app_errors RLS policies   — `... OR raw_user_meta_data->>'role'  ║
-- ║                                   = 'admin'`                          ║
-- ║   3. contact_messages RLS      — same pattern                         ║
-- ║                                                                       ║
-- ║   `raw_user_meta_data` is writable by the user via                   ║
-- ║   `supabase.auth.updateUser({ data: { role: 'admin' } })`. Any        ║
-- ║   authenticated user could self-elevate and bypass admin gates that   ║
-- ║   relied on these callsites.                                         ║
-- ║                                                                       ║
-- ║ Fix:                                                                 ║
-- ║   • Re-define is_current_user_admin() to use the email allow-list     ║
-- ║     (same logic as the canonical public.is_admin() function).         ║
-- ║   • Re-define the four vulnerable RLS policies on app_errors and      ║
-- ║     contact_messages to call public.is_admin() instead of the         ║
-- ║     inline metadata check.                                            ║
-- ║                                                                       ║
-- ║ Impact:                                                              ║
-- ║   Any user who manually set user_metadata.role='admin' on themselves  ║
-- ║   (via admin_set_role or direct auth.updateUser) will lose admin     ║
-- ║   access via these callsites. They retain admin access ONLY if their ║
-- ║   email is on the public.is_admin() allow-list. Today the allow-list ║
-- ║   contains 'ofek205@gmail.com' only.                                  ║
-- ║                                                                      ║
-- ║   The admin_set_role RPC remains in place but its writes to           ║
-- ║   user_metadata.role are no longer load-bearing — they're a no-op as ║
-- ║   far as authorization goes. A future cleanup commit can deprecate    ║
-- ║   admin_set_role entirely or repurpose it to write to a server-       ║
-- ║   managed admins table.                                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 1. is_current_user_admin() — switch to email allow-list ──────────────
-- Keeps the name + signature so every existing caller (RLS + RPCs) keeps
-- working without changes. The implementation now mirrors public.is_admin().

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Server-controlled email allow-list. user_metadata.role IS NOT TRUSTED.
  -- See audit follow-up 2026-05-12 (privesc closure).
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) in ('ofek205@gmail.com')
  );
$$;

-- Keep the existing grant in place.
revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;


-- ── 2. app_errors RLS — drop metadata clause, keep email + delegate ──────
-- Inline metadata check is gone. Email allow-list + is_admin() RPC stand.

drop policy if exists app_errors_admin_read   on public.app_errors;
drop policy if exists app_errors_admin_update on public.app_errors;

create policy app_errors_admin_read
  on public.app_errors
  for select to authenticated
  using (public.is_admin());

create policy app_errors_admin_update
  on public.app_errors
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ── 3. contact_messages RLS — same treatment ────────────────────────────

drop policy if exists contact_admin_read   on public.contact_messages;
drop policy if exists contact_admin_update on public.contact_messages;

create policy contact_admin_read
  on public.contact_messages
  for select to authenticated
  using (public.is_admin());

create policy contact_admin_update
  on public.contact_messages
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ── 4. Sanity probe (optional — run separately to verify) ───────────────
-- Run this AS a non-admin user (NOT as ofek205@gmail.com) to confirm the
-- closure:
--   select public.is_admin();              -- expect false
--   select public.is_current_user_admin(); -- expect false (was true if you'd
--                                          --   set user_metadata.role='admin')
--   select count(*) from public.app_errors;          -- expect 0 rows
--   select count(*) from public.contact_messages;    -- expect 0 rows
