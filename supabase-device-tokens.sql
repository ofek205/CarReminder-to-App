-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ device_tokens — FCM/APNs tokens for server-side push                 ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Stores one row per (user_id, token) pair so a user signed into the   ║
-- ║ app on multiple devices receives pushes on all of them. Tokens that  ║
-- ║ rotate (FCM does this periodically) get a new row inserted; stale    ║
-- ║ rows are pruned automatically by `prune_stale_device_token` when the ║
-- ║ dispatch Edge Function reports a "not-registered" send failure.      ║
-- ║                                                                      ║
-- ║ RLS: users can only see + manage their own tokens. The dispatch      ║
-- ║ Edge Function uses SERVICE_ROLE_KEY which bypasses RLS, so it can    ║
-- ║ enumerate tokens across all recipients.                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝

create table if not exists public.device_tokens (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  token       text        not null,
  platform    text        not null check (platform in ('ios', 'android', 'web')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Unique on (user_id, token) so the upsert in src/lib/pushNotifications.js
-- (which uses ON CONFLICT (user_id, token)) is a no-op when the same
-- device re-registers with the same token — only updated_at advances.
create unique index if not exists device_tokens_user_token_uniq
  on public.device_tokens(user_id, token);

-- Lookup index: dispatch-push hits this on every send to enumerate a
-- recipient's devices. Covers the common "WHERE user_id = $1" pattern.
create index if not exists device_tokens_user_idx
  on public.device_tokens(user_id);

alter table public.device_tokens enable row level security;

-- A user can read their own rows (Account settings page could surface
-- "this account is signed in on N devices" later — not built yet).
create policy device_tokens_select on public.device_tokens
  for select using (user_id = auth.uid());

-- Insert is gated by user_id = auth.uid() — the client passes user_id
-- explicitly in the upsert; even if a malicious caller substitutes a
-- different uid, RLS rejects the row before it lands.
create policy device_tokens_insert on public.device_tokens
  for insert with check (user_id = auth.uid());

-- Update lets the same user refresh `updated_at` on re-register without
-- inserting a new row (paired with the ON CONFLICT clause).
create policy device_tokens_update on public.device_tokens
  for update using (user_id = auth.uid())
              with check (user_id = auth.uid());

-- Delete lets a user remove their own token (e.g. on sign-out, or via
-- the "remove this device" UI we may add later).
create policy device_tokens_delete on public.device_tokens
  for delete using (user_id = auth.uid());

-- Helper: prune a stale token by string match. Called from the dispatch
-- Edge Function (with SERVICE_ROLE key) when FCM/APNs returns
-- "not-registered" or "invalid-registration" for a specific token.
-- Marked SECURITY DEFINER so the function bypasses RLS — it's the only
-- legitimate caller and the service-role context is already trusted.
create or replace function public.prune_stale_device_token(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.device_tokens where token = p_token;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.prune_stale_device_token(text) from public;
grant execute on function public.prune_stale_device_token(text) to service_role;

comment on table  public.device_tokens                 is 'FCM/APNs device tokens for server-side push delivery.';
comment on column public.device_tokens.token           is 'Raw FCM token (Android) or APNs token (iOS), as received from PushNotifications.register().';
comment on column public.device_tokens.platform        is 'ios | android | web. Web is reserved for future browser push (not used today).';
comment on function public.prune_stale_device_token(text) is 'Service-role-only helper used by dispatch-push to remove tokens that FCM/APNs report as no longer registered.';
