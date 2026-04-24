-- ==========================================================================
-- ai_provider_settings — admin-controlled AI provider per feature.
--
-- Purpose:
--   Let an admin pick which upstream AI service (gemini / groq / claude /
--   'auto') serves each feature (community expert chat, Yossi chat, document
--   OCR). Previously the ai-proxy Edge Function had a hard-coded priority
--   (Groq text / Gemini vision / Claude fallback); this makes it runtime-
--   configurable so we can swap providers without redeploying.
--
-- Security:
--   Only admins read/write via the RPCs. The table is not exposed directly
--   to the client via REST; we expose two SECURITY DEFINER RPCs:
--     - public.get_ai_provider(feature) → text (any authenticated caller)
--     - public.set_ai_provider(feature, provider) → void (admins only)
--
--   Default provider when no row exists: 'gemini' (explicit project choice,
--   not 'auto') — Gemini has the widest modality coverage for this app's
--   use cases (text chat + image OCR in one provider).
--
-- Safe to re-run.
-- ==========================================================================

create table if not exists public.ai_provider_settings (
  feature            text primary key,
  preferred_provider text not null default 'gemini',
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null,

  constraint ai_provider_valid check (
    preferred_provider in ('gemini', 'groq', 'claude', 'auto')
  ),
  constraint feature_valid check (
    feature in ('community_expert', 'yossi_chat', 'scan_extraction')
  )
);

-- Seed defaults for the 3 known features. ON CONFLICT keeps existing admin
-- choices intact across re-runs.
insert into public.ai_provider_settings (feature, preferred_provider)
values
  ('community_expert', 'gemini'),
  ('yossi_chat',       'gemini'),
  ('scan_extraction',  'gemini')
on conflict (feature) do nothing;

-- RLS on for defense-in-depth. All access is through the RPCs below; a
-- stray client read would return nothing without the grants.
alter table public.ai_provider_settings enable row level security;

drop policy if exists ai_provider_settings_select on public.ai_provider_settings;
drop policy if exists ai_provider_settings_write  on public.ai_provider_settings;

-- Admins can read via the table directly (handy for dashboards); non-admins
-- use the RPC.
create policy ai_provider_settings_select on public.ai_provider_settings
  for select using (public.is_admin());

create policy ai_provider_settings_write on public.ai_provider_settings
  for all using (public.is_admin()) with check (public.is_admin());


-- ──────────────────────────────────────────────────────────────────────────
-- get_ai_provider(feature)
--   Read-only. Any authenticated user can ask "which provider should I use
--   for feature X". Falls back to 'gemini' when the row is missing or the
--   feature string is unknown — matches our project-wide default.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.get_ai_provider(p_feature text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select preferred_provider from public.ai_provider_settings where feature = p_feature),
    'gemini'
  );
$$;

revoke all on function public.get_ai_provider(text) from public;
grant execute on function public.get_ai_provider(text) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- set_ai_provider(feature, provider)
--   Admin-only. Validates the two inputs against the CHECK constraints and
--   upserts. Stamps updated_by with auth.uid() for an audit trail.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.set_ai_provider(p_feature text, p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_required';
  end if;

  if p_feature not in ('community_expert', 'yossi_chat', 'scan_extraction') then
    raise exception 'invalid_feature: %', p_feature;
  end if;

  if p_provider not in ('gemini', 'groq', 'claude', 'auto') then
    raise exception 'invalid_provider: %', p_provider;
  end if;

  insert into public.ai_provider_settings (feature, preferred_provider, updated_at, updated_by)
  values (p_feature, p_provider, now(), auth.uid())
  on conflict (feature) do update
    set preferred_provider = excluded.preferred_provider,
        updated_at         = excluded.updated_at,
        updated_by         = excluded.updated_by;
end $$;

revoke all on function public.set_ai_provider(text, text) from public;
grant execute on function public.set_ai_provider(text, text) to authenticated;


-- Refresh PostgREST cache so the client sees the new RPCs immediately.
notify pgrst, 'reload schema';
