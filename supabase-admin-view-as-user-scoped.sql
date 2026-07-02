-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-user-scoped.sql — "see everything he sees" (Approach A)
--
-- Lets an admin, DURING an active audited view session, READ the TARGET user's
-- user-scoped data (notifications, reminder settings, profile, activity) — so
-- view-as shows what the user sees, not the admin. Additive + fail-closed.
--
-- Depends on: public.is_admin(), public.admin_view_sessions (target_user_id).
-- Spec: docs/admin-view-as-full-visibility-spec.md. Run ONCE in SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── is_viewing_user — admin in an active session whose TARGET is this user ────
-- Mirrors is_viewing(account_id) but keyed on the target USER. Fail-closed:
-- is_admin() AND an active, unexpired, own session → false for every non-admin.
create or replace function public.is_viewing_user(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_admin() and exists (
    select 1
    from public.admin_view_sessions s
    where s.admin_user_id  = auth.uid()
      and s.target_user_id = p_user_id
      and s.ended_at is null
      and s.expires_at > now()
  );
$$;

grant execute on function public.is_viewing_user(uuid) to authenticated;


-- ── Session-gated SELECT policies (additive; OR'd with the user's own-row ones)
-- READ-ONLY for notifications + profile (decision: admin views, never mutates
-- the target's unread state / profile). Reminder settings also gets an UPDATE
-- policy below (admin may fix the target's reminder prefs during support).

drop policy if exists view_select_notifications on public.app_notifications;
create policy view_select_notifications on public.app_notifications
  for select to authenticated
  using (public.is_viewing_user(user_id));

drop policy if exists view_select_reminder_settings on public.reminder_settings;
create policy view_select_reminder_settings on public.reminder_settings
  for select to authenticated
  using (public.is_viewing_user(user_id));

drop policy if exists view_select_user_profiles on public.user_profiles;
create policy view_select_user_profiles on public.user_profiles
  for select to authenticated
  using (public.is_viewing_user(user_id));

-- Snoozes are READ-ONLY in view-as (so the admin sees which reminders the
-- target muted; muting/unmuting on their behalf stays disabled in the client).
drop policy if exists view_select_reminder_snoozes on public.reminder_snoozes;
create policy view_select_reminder_snoozes on public.reminder_snoozes
  for select to authenticated
  using (public.is_viewing_user(user_id));


-- ── Reminder settings: allow WRITE during view-as (decision #1) ───────────────
-- An admin fixing the target's reminder timing is a plausible support action.
-- INSERT covers first-time provisioning; UPDATE covers edits. Both gated.
drop policy if exists view_insert_reminder_settings on public.reminder_settings;
create policy view_insert_reminder_settings on public.reminder_settings
  for insert to authenticated
  with check (public.is_viewing_user(user_id));

drop policy if exists view_update_reminder_settings on public.reminder_settings;
create policy view_update_reminder_settings on public.reminder_settings
  for update to authenticated
  using (public.is_viewing_user(user_id))
  with check (public.is_viewing_user(user_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (as the admin, mid-session, in the app — auth.uid() is null in editor):
--   select public.is_viewing_user('<target_user_id>');   -- true only mid-session
-- ═══════════════════════════════════════════════════════════════════════════
