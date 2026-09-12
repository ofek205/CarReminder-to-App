-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-ai-consents-2026-09-08.sql
--
-- Explicit consent to share data with third-party AI providers.
--
-- WHY
--   App Store Guideline 5.1.2(i), as updated 2026-11-13, requires that an app
--   "clearly disclose where personal data will be shared with third parties,
--   including with third-party AI, and obtain explicit permission before
--   doing so". A privacy-policy link is disclosure, not permission. The app
--   currently sends user-typed chat text, community posts, and photographed
--   documents to Google (Gemini), Groq and Anthropic with no consent step
--   anywhere.
--
--   Design: docs/ux-ai-consent.md
--
-- WHY A TABLE AND NOT localStorage OR user_metadata
--   A consent that disappears on reinstall is not a consent, and it must
--   carry a record of what was agreed to and when. `user_metadata` is
--   client-writable and is already documented in this project as an
--   "analytics HINT only, never for security", so it is the wrong home for
--   a permission record.
--
-- TWO KINDS, DELIBERATELY
--   ai_text    chat + community replies + vessel advice. The text the user
--              wrote.
--   ai_images  document and plate scanning. A PHOTO of a driving licence,
--              vehicle registration, insurance or receipt, which carries an
--              ID number, an address and a date of birth.
--   One blanket consent would make someone who is fine asking a question
--   also agree to sending their licence, which is not what they meant.
--
-- VERSION IS WHAT KEEPS THE CONSENT HONEST
--   `version` is part of the primary key. If the set of providers changes
--   (a fourth vendor, a new surface), bumping the app-side constant asks
--   again instead of leaning on a consent given for a different disclosure.
--   Old rows stay, so there is a record of which disclosure each user saw.
--
-- SAFETY
--   Additive only: one new table. No change to any existing table, no
--   trigger, no change to anyone else's RLS. Idempotent, re-runnable.
--
-- APPLY
--   Supabase SQL Editor, once. Then record the apply in the ledger:
--     node scripts/sql-ledger.cjs record supabase-ai-consents-2026-09-08.sql
--   (CLAUDE.md gate 5: staging shares this database with production, so this
--   runs against live data. It is additive, so nothing existing is touched.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. table ──────────────────────────────────────────────────────────────
create table if not exists public.ai_consents (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null,
  version    integer     not null,
  granted_at timestamptz not null default now(),
  -- Non-null means the user turned it back off. Re-granting the same
  -- version clears it and refreshes granted_at; the version dimension is
  -- what preserves history across disclosure changes.
  revoked_at timestamptz,
  primary key (user_id, kind, version),
  constraint ai_consents_kind_chk check (kind in ('ai_text', 'ai_images')),
  constraint ai_consents_version_chk check (version >= 1)
);

comment on table public.ai_consents is
  'Explicit consent to share data with third-party AI providers (App Store 5.1.2(i)). See docs/ux-ai-consent.md.';

-- Read path is always "this user, this kind, current version", which the
-- primary key already serves. This index is for the admin/compliance
-- question "who has consented to what", which has no user_id to lead with.
create index if not exists ai_consents_kind_version_idx
  on public.ai_consents (kind, version)
  where revoked_at is null;

-- ── 2. RLS ────────────────────────────────────────────────────────────────
-- The user is the only party who can grant or withdraw their own consent,
-- so unlike most tables in this project the client writes here directly.
-- Every policy is pinned to auth.uid(); there is no path to another user's
-- row, and no DELETE policy at all (withdrawing is an UPDATE, so the record
-- of having consented is not erasable by the client).
alter table public.ai_consents enable row level security;

drop policy if exists ai_consents_select_own on public.ai_consents;
create policy ai_consents_select_own on public.ai_consents
  for select using (auth.uid() = user_id);

drop policy if exists ai_consents_insert_own on public.ai_consents;
create policy ai_consents_insert_own on public.ai_consents
  for insert with check (auth.uid() = user_id);

-- WITH CHECK as well as USING: without it a user could update their own row
-- and rewrite user_id to someone else's id, forging a consent on their
-- behalf. The 2026-06-07 audit found exactly this shape of gap on documents
-- and accounts, so it is spelled out rather than assumed.
drop policy if exists ai_consents_update_own on public.ai_consents;
create policy ai_consents_update_own on public.ai_consents
  for update using (auth.uid() = user_id)
          with check (auth.uid() = user_id);

-- ── 3. admin visibility ───────────────────────────────────────────────────
-- Compliance question: "can we show that consent was obtained?" Admins can
-- read, never write. is_admin() is SECURITY DEFINER and is already the gate
-- used across this project's admin surfaces.
drop policy if exists ai_consents_select_admin on public.ai_consents;
create policy ai_consents_select_admin on public.ai_consents
  for select using (public.is_admin());

-- ── 4. verify ─────────────────────────────────────────────────────────────
-- Expect: 4 policies, rowsecurity = true, 0 rows.
--
--   select policyname, cmd from pg_policies
--    where tablename = 'ai_consents' order by policyname;
--
--   select relrowsecurity from pg_class
--    where oid = 'public.ai_consents'::regclass;
--
--   select count(*) from public.ai_consents;
--
-- ROLLBACK (nothing else references this table):
--   drop table if exists public.ai_consents;
