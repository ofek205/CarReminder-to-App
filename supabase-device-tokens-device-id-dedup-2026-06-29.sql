-- ═══════════════════════════════════════════════════════════════════════════
-- device_tokens — one row per physical device (kills the rotation-window
-- duplicate push). 2026-06-29.
--
-- Problem
-- -------
-- dispatch-push fans out to EVERY device_tokens row for a user. The table was
-- keyed unique(user_id, token) (index `device_tokens_user_token_uniq`), so when
-- FCM/APNs rotates a device's token the client inserted a NEW row and the old
-- row lingered until a failed send pruned it. In the window where BOTH the old
-- and the new token are still deliverable, ONE app_notifications event → TWO
-- banners on the SAME physical device. The client-side collapse of the bell /
-- realtime local-fire paths cannot reach this — it is purely server-side.
--
-- Fix
-- ---
-- Key the table on a stable per-install id instead of the rotating token:
--   1. add device_id (per-install UUID the client persists in localStorage —
--      see getInstallId() in src/lib/pushNotifications.js),
--   2. backfill existing rows device_id = token (each existing row keeps a
--      distinct, non-null id, so nothing collides and no current device is
--      dropped from the fan-out),
--   3. swap the uniqueness from (user_id, token) → (user_id, device_id).
-- The client then upserts ON CONFLICT (user_id, device_id): a token rotation
-- UPDATES the install's single row in place — no second row, no duplicate.
--
-- DEPLOY ORDER (important): apply THIS migration BEFORE shipping the native
-- build whose pushNotifications.js upserts ON CONFLICT (user_id, device_id).
-- If the client ships first, the upsert has no matching unique index and device
-- registration throws (caught + logged in pushNotifications.js; push simply
-- stops registering new tokens until the migration lands). Web is unaffected —
-- web never registers push.
--
-- One-time adoption tail: an EXISTING device, on its first registration after
-- the new build, inserts a fresh (user_id, install-UUID) row while its old
-- token-keyed row still exists → at most ONE transient duplicate until the old
-- token goes stale and is pruned on the next failed send. Steady state
-- afterwards is exactly one row per device; new installs are clean from their
-- first registration.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Per-install identifier column. Nullable on purpose — legacy/other insert
--    paths must not break, and the unique index treats NULLs as distinct.
alter table public.device_tokens
  add column if not exists device_id text;

-- 2. Backfill existing rows so every row has a distinct, non-null device_id.
--    Using the token guarantees no collisions and preserves every current
--    device in the fan-out until it re-registers under its install UUID.
update public.device_tokens
   set device_id = token
 where device_id is null;

-- 3. Swap uniqueness: drop the old (user_id, token) unique index, add the new
--    (user_id, device_id) one. ON CONFLICT (user_id, device_id) targets it.
drop index if exists public.device_tokens_user_token_uniq;

create unique index if not exists device_tokens_user_device_uniq
  on public.device_tokens(user_id, device_id);

-- 4. prune_stale_device_token() filters by token alone; keep that fast now that
--    the (user_id, token) index is gone.
create index if not exists device_tokens_token_idx
  on public.device_tokens(token);

comment on column public.device_tokens.device_id is
  'Stable per-install id (UUID from getInstallId() in pushNotifications.js). Uniqueness is (user_id, device_id) so a rotated push token updates this install''s single row instead of inserting a duplicate — prevents the rotation-window double-push.';

-- ── Verify (run after applying) ──────────────────────────────────────────────
-- Expect: every row has a non-null device_id, and no (user_id, device_id) dupes.
--   select count(*) as total,
--          count(*) filter (where device_id is null) as null_device_id
--     from public.device_tokens;
--   select user_id, device_id, count(*)
--     from public.device_tokens
--    group by 1, 2 having count(*) > 1;   -- expect 0 rows
