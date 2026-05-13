-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ community_blocked_users — server-side admin moderation list           ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Audit follow-up L-1: prior to this table, the admin "block user"     ║
-- ║ action in PostCard.jsx wrote to the admin's own localStorage. That   ║
-- ║ meant a moderation decision was only effective in the browser of the ║
-- ║ admin who issued it — other admins (or even the same admin in        ║
-- ║ another tab/device) couldn't see the block, and the blocked user's   ║
-- ║ posts still surfaced for every other user in the community.          ║
-- ║                                                                       ║
-- ║ This table makes the block global: posts/comments by any user_id in  ║
-- ║ the list are hidden from every reader of the community feed.         ║
-- ║                                                                       ║
-- ║ RLS posture:                                                          ║
-- ║   SELECT — every authenticated user (so the client filter can read   ║
-- ║            the list of ids to exclude from the feed).                ║
-- ║   INSERT — only admins (via public.is_admin()).                       ║
-- ║   DELETE — only admins (unblock).                                     ║
-- ║   UPDATE — not exposed (rows are immutable).                          ║
-- ║                                                                       ║
-- ║ Privacy tradeoff: any authenticated user can query the list and      ║
-- ║ discover whether their own user_id is on it. That's acceptable for   ║
-- ║ a moderation feature — blocked users would notice their posts get    ║
-- ║ no engagement anyway. If stealth blocking becomes a requirement     ║
-- ║ later, swap the SELECT policy for a SECURITY DEFINER RPC that        ║
-- ║ returns the array without exposing individual rows.                   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

create table if not exists public.community_blocked_users (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  blocked_by  uuid        not null references auth.users(id) on delete set null,
  blocked_at  timestamptz not null default now(),
  reason      text
);

create index if not exists community_blocked_users_blocked_by_idx
  on public.community_blocked_users(blocked_by);

alter table public.community_blocked_users enable row level security;

-- SELECT — every authenticated user can read the list so the client
-- feed filter can apply it.
drop policy if exists community_blocked_users_select on public.community_blocked_users;
create policy community_blocked_users_select
  on public.community_blocked_users
  for select to authenticated
  using (true);

-- INSERT — only admins. The is_admin() function is the same one used
-- by every other admin-only RPC in the codebase.
drop policy if exists community_blocked_users_insert on public.community_blocked_users;
create policy community_blocked_users_insert
  on public.community_blocked_users
  for insert to authenticated
  with check (public.is_admin());

-- DELETE — only admins (unblock).
drop policy if exists community_blocked_users_delete on public.community_blocked_users;
create policy community_blocked_users_delete
  on public.community_blocked_users
  for delete to authenticated
  using (public.is_admin());

comment on table  public.community_blocked_users             is 'Global admin block list for the community feed (audit L-1, 2026-05-13).';
comment on column public.community_blocked_users.user_id     is 'The blocked user. Posts/comments by this user are hidden community-wide.';
comment on column public.community_blocked_users.blocked_by  is 'Which admin issued the block. Kept for audit; nullable on admin deletion.';
comment on column public.community_blocked_users.reason      is 'Optional free text the admin can attach when blocking (not surfaced to UI today).';
