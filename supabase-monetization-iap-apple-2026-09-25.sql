-- =========================================================================
-- Monetization: the App Store half of in-app subscriptions.
--
-- WHAT THIS IS
--   Two rows of configuration and nothing else. The server side of Apple
--   billing already exists: grant_iap_entitlement() maps store 'apple' to
--   source 'iap_apple' and looks the product up in public.iap_products, and
--   account_plan() (ledger 31) already ages out 'iap_apple' like
--   'iap_google'. What it lacks is any Apple product to look up, so today
--   every Apple grant would raise "unknown or inactive product".
--
-- WHY A NEW FILE
--   The IAP entitlement file is applied and recorded (ledger 29). The ledger
--   keys on sha256, so an addition is a new file, never an edit.
--
-- ⚠️ APPLY ONLY AFTER THE THREE SUBSCRIPTIONS EXIST IN APP STORE CONNECT WITH
--   EXACTLY THESE PRODUCT IDS. Apple product ids are permanent and can never
--   be reused in the same app, even after deletion. The rows are harmless
--   before that (a row only grants when Apple itself confirms a purchase of
--   that id), but a row naming an id Apple never had is a lie in the one
--   table the grant trusts.
--
-- ⚠️ THE IDS ARE IDENTICAL TO GOOGLE'S ON PURPOSE. One spelling per plan in
--   both stores leaves nothing to cross. The primary key is (store,
--   product_id), so the same id under two stores is two distinct rows.
--
-- Nothing here is reachable by a user: the flag is seeded false, and the
-- app does not offer a purchase on iOS at all until the client is wired.
-- =========================================================================


-- ── 1. Which App Store product grants which plan ──────────────────────────
-- Levels are Apple's ranking inside the subscription group, 1 = most. They
-- decide what counts as an upgrade (immediate, prorated) and a downgrade
-- (at the next renewal), and they are written down here so the console and
-- this table can be checked against each other.
insert into public.iap_products (store, product_id, plan, note)
values
  ('apple', 'plan_p9',  'p9',  'App Store auto-renewable, monthly, group level 3'),
  ('apple', 'plan_p19', 'p19', 'App Store auto-renewable, monthly, group level 2'),
  ('apple', 'plan_p49', 'p49', 'App Store auto-renewable, monthly, group level 1')
on conflict (store, product_id) do nothing;


-- ── 2. The flag the iOS client will read ──────────────────────────────────
-- Separate from play_billing_enabled because the two stores become ready at
-- different times: Apple needs its own agreement, products, key and
-- notification URL, and switching Play on must not switch Apple on with it.
--
-- ⚠️ DO NOT TURN THIS ON UNTIL ALL FOUR ARE TRUE, because each one alone
-- produces a screen that lies or a subscriber that silently expires:
--   1. app-store-notifications is deployed and a TEST notification has
--      arrived. Without it every Apple subscriber drops to free ~a month in.
--   2. verify-apple-purchase is deployed with the three APPLE_IAP_* secrets.
--   3. The three subscriptions exist in App Store Connect with these ids.
--   4. An iOS build carrying the client half is live or in review.
--
-- ⚠️ AND IT MUST BE ON WHILE THE FIRST SUBSCRIPTION IS IN APP REVIEW. Apple
-- requires the first subscription to be submitted together with a new app
-- version, and a reviewer who cannot find the purchase rejects it. The
-- reviewer is not an admin, so the admin bypass does not help them.
insert into public.app_config (key, value)
values ('apple_billing_enabled', 'false'::jsonb)
on conflict (key) do nothing;


-- =========================================================================
-- VERIFICATION. Run this and paste what you actually saw.
--
--   select
--     (select count(*) from public.iap_products where store = 'apple')     as apple_products,
--     (select string_agg(product_id || '=' || plan, ', ' order by product_id)
--        from public.iap_products where store = 'apple' and active)          as mapping,
--     (select value #>> '{}' from public.app_config
--       where key = 'apple_billing_enabled')                                 as apple_flag;
--
-- Expected after:  3 | plan_p19=p19, plan_p49=p49, plan_p9=p9 | false
-- Before applying: 0 | NULL                                   | NULL
--
-- ⚠️ Every column differs between the two states, so a pasted result can
--    only be read one way. The Google rows are untouched; to confirm:
--      select count(*) from public.iap_products where store = 'google';  -- 3
-- =========================================================================
