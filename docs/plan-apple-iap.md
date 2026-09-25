# Apple / StoreKit subscriptions: plan

Status 2026-09-25: **merged** (PR #75, af4cf91d, main == staging). All client and server code is in; still inert: functions not deployed, SQL not applied, no native build, apple_billing_enabled absent. Remaining work is Apple setup, deploy, a TestFlight build and the device test (runbook). Terms section waits on feat/terms-subscriptions.
Companion: [runbook-app-store-connect-iap.md](runbook-app-store-connect-iap.md) (Ofek's App Store Connect checklist, in Hebrew).
Android history this mirrors: `docs/spec-monetization-play-billing.md`, `docs/ux-play-billing-purchase.md`.

## 1. Product (pm)

**Problem.** An iOS user cannot pay at all, and under Guideline 3.1.1(a) iOS may not even name a paid plan. The App Store is where current growth comes from (Sept 2026 signup spike), so iOS is the larger half of the paying audience that exists.

**Goal.** p9 / p19 / p49 (₪9 / ₪19 / ₪49, monthly, feature-identical except the vehicle ceiling) purchasable through StoreKit, granted only on Apple's word, and kept current by Apple's server notifications without the user opening the app.

**User stories**
- A free iOS user at the vehicle cap buys p9 in the StoreKit sheet and has the higher cap within seconds.
- A subscriber reinstalls, signs in, and the plan is still there without paying again.
- A subscriber renews monthly and never opens the app; the plan does not lapse.
- A subscriber cancels in iOS Settings: keeps the plan until the paid period ends, then drops to free with nothing deleted.
- A subscriber is refunded by Apple: drops to free.
- A child whose purchase needs a parent's approval (Ask to Buy) is not told their payment failed.

### Slice 1 (this branch): everything store-side and server-side, not wired

| Must | Done |
|---|---|
| Apple backend over `@capgo/native-purchases` 8.7.0, tests with mocks derived from its Swift | ✅ `src/lib/billing/appleBackend.js` + test |
| App Store Server API helpers, tested | ✅ `supabase/functions/_shared/appleStore.ts` + test |
| `verify-apple-purchase` edge function | ✅ written, **not deployed** |
| App Store Server Notifications V2 endpoint | ✅ `app-store-notifications`, written, **not deployed** |
| `iap_products` Apple rows + `apple_billing_enabled` seeded false | ✅ `supabase-monetization-iap-apple-2026-09-25.sql`, **not applied** |
| App Store Connect checklist for Ofek | ✅ runbook |
| Native plugin compiled into the iOS app | ✅ slice 2a, Podfile entry; **never compiled yet** (§3 finding 1) |

**Acceptance for slice 1:** all new tests green; lint 0 errors; no screen, flag or query changes behaviour for any user; `getBillingBackend()` still returns `null` on iOS (pinned by `backendIdentity.test.js`).

**Out of scope for slice 1:** wiring into `/Plans`, `/MyPlan` and the cap wall; the `billingGate` iOS flip; copy; any iOS build; deploys; SQL application; offer codes, intro offers, promoted purchases, Family Sharing, web checkout.

### Open decisions (Ofek's)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Apple product ids | Identical to Play: `plan_p9`, `plan_p19`, `plan_p49`. Nothing to cross. Permanent once created. |
| D2 | Exact price | ₪9.00 / ₪19.00 / ₪49.00. Apple publishes both X.00 and X.90 ILS points; confirm in the picker. Set **Israel as the base storefront** so Apple's ILS adjustments do not move it. |
| D3 | Availability | Israel only, same as Play. Same open question as Android: Israelis whose Apple ID is registered abroad cannot buy. |
| D4 | Family Sharing | **Off.** A family-shared copy carries no link to a CarReminder account, and the server refuses it. |
| D5 | Sandbox purchases on the production server | **Accept.** Required for App Review; cost is that TestFlight testers get a plan free until the sandbox subscription lapses (6 daily renewals). |
| D6 | billingGate on iOS (3.1.1(a)) | Flip **per iapReady**, not per build. Exact diff in §4. |
| D7 | `label_he` prints "₪9 לחודש" on iOS | Existing open decision (`docs/ux-plans-redesign.md` §1.11, on the unpushed `feat/plans-redesign` branch). With StoreKit live, the store's price is the only one to show; a DB price beside it risks a mismatch. |
| D8 | Ask to Buy copy | PENDING today renders "התשלום נקלט", which is false while a parent has not approved. Needs its own copy (§4 item 5). |
| D9 | One account paying both stores | UI must not offer a purchase on iOS when the account's plan is `iap_google`, and vice versa. Server grants and reports it, and the renewal path refuses to fight over it. |
| D10 | Small Business Program | Enroll: 15% instead of 30% from the first month. |

## 2. Engineering (tech-lead)

**Approach.** Mirror the Play half piece for piece and reuse everything store-agnostic (`purchaseMachine`, `usePurchaseFlow`, `grant_iap_entitlement`, `revoke_iap_entitlement`, `account_plan()` expiry). Server trust model is Play's: the client's claim is a hint; only Apple's API answer grants.

| Android | Apple (this branch) | Difference that matters |
|---|---|---|
| `buildPlayBackend()` | `buildAppleBackend()` + `appleBackend()` singleton | no base plans; token is the StoreKit `transactionId`; auto-finish true |
| `verify-play-purchase` | `verify-apple-purchase` | checks Apple's signed `appAccountToken` equals the account (Play checks only membership); keyed by `originalTransactionId` |
| `play-rtdn` | `app-store-notifications` | resolves an unknown purchase through Apple's signed account token, so it can grant a purchase the device never reported |
| `_shared/googlePlay.ts` | `_shared/appleStore.ts` | pure and vitest-covered; no `Deno.*` at import |

**Why the notification's signature is not verified.** Nothing from a notification body is written. It only names the subscription; state, product, dates and account all come from a fresh App Store Server API call. A forged notification can only make us re-read the truth. The URL secret only stops strangers making us call Apple.

**Why `originalTransactionId` is the external id.** Every renewal and every in-group upgrade mints a new `transactionId`; the original id is stable for the life of the subscription and is what notifications resolve by.

**Grace.** `status 4` grants, and the period end written is `max(expiresDate, gracePeriodExpiresDate)`, because in grace `expiresDate` is already past and `account_plan()` would age the plan out while Apple is still retrying the card.

### Risks

| Risk | L | I | Mitigation |
|---|---|---|---|
| Plugin never compiled on iOS (no Mac) | M | H | Podfile entry in slice 2a; Ofek runs one iOS build as a deliberate compile check while /Plans waits; same swift_version as the plugins that build today; a failure stops before upload |
| Apple drops the query-string secret | L | H | path-segment secret accepted too; the `probe=test` call proves which form works before launch |
| Cancellation misread on a Hebrew device | M | M | exact plugin strings matched first; thrown errors are localised, fallback errs to CANCELLED; 🔴 confirm on device |
| "Already subscribed" returns cancelled while charging (community reports) | L | M | server grants from the notification via Apple's account token; restore at mount |
| Double subscription across stores | L | M | report on verify; renewal path steps aside; UI prevention is slice 2 |
| Notifications not live before first subscriber | M | H | flag stays off until the TEST probe arrives (runbook step order) |

### Testing done

- `appleBackend.test.js`: 29 tests. The fake reproduces the Swift rule for rule, with negative controls on the fake itself (drops a non-uuid token silently, returns the token upper-case, filters `getPurchases` case-sensitively, omits unknown products without rejecting).
- `appleStore.test.ts`: 27 tests: ES256 token claims and a real signature verified with WebCrypto, production-then-sandbox fallback (and no fallback on 401), JWS decode, every subscription status, grace deadline, refund, account binding.
- Edge functions type-checked with the local TypeScript compiler against stubbed URL imports (0 errors in the new files). **Not run**: no Deno here, and deploying is Ofek's.

**Not verified at all:** anything on a device, anything against Apple's live API, the iOS compile.

## 3. Findings while reading the code

1. **The Apple plugin is not in the Podfile.** The iOS build is CocoaPods-driven and hand-maintained; `npx cap sync` updates the unused SPM package instead. This is the third plugin this happened to (push notifications, Sign in with Apple). Without the line, StoreKit can never work and the JS falls back to the web stub in silence. Held out of slice 1 so the first compile would not surprise an unrelated release; **added in slice 2a** once the wiring started, because the wait for `/Plans` is the best time to learn whether it compiles. Only Ofek runs iOS builds, so the first one is a deliberate compile check.
2. **iOS does not reject an unknown product id.** Android rejects "Product not found"; StoreKit just returns fewer products. The backend counts and reports every gap, with the storefront country, which is the fact that cost three days on Android. No native patch is needed.
3. **The plugin compares account tokens case-sensitively against Swift's upper-case `uuidString`.** Its own `getPurchases` filter can never match a lower-case account id. Filtered in JS instead.
4. **The plugin drops a non-uuid `appAccountToken` with no error.** Refused before the sheet opens.
5. **The plugin auto-finishes every transaction arriving through `Transaction.updates`**, whatever `autoAcknowledgePurchases` says. Combined with Apple having no refund-if-unfinished rule, the iOS backend auto-finishes too; recovery rests on `currentEntitlements` and the notification endpoint.
6. **`MARKETING_VERSION = 6.4.0` in the pbxproj is not what ships.** `ios-release.yml` runs `agvtool new-marketing-version` from `package.json` since 16dad499, so a TestFlight build today would be 6.5.13 with build number 100 + run number. The handoff note calling it hardcoded is stale. Not re-verified by a build.
7. **For the Android session:** `play-rtdn` revokes whatever store holds the account, and `verify-play-purchase` does not compare `obfuscatedExternalAccountId` to the account. Harmless while only Play sells; once Apple sells, an Android notification about an old token could drop an Apple subscriber to free. The Apple endpoint guards its own revoke.

## 4. Slice 2: wiring (needs coordination with the `/Plans` redesign)

Items marked ✅ are done in slice 2a (`feat/apple-iap-wiring`). The rest are in `Plans.jsx` / `PurchaseAction.jsx` / `VerifyingBanner`, which the `/Plans` redesign rewrites, and wait for it (agreed with that session 2026-09-25).

0. ✅ `ios/App/Podfile`, inside `capacitor_pods`, after the Apple sign-in pod. The first CI iOS build after this is the compile check; it fails before the upload step if the plugin does not build.

```ruby
  pod 'CapgoNativePurchases',         :path => '../../node_modules/@capgo/native-purchases'
```

1. `src/lib/billing/index.js`: ✅ `canOpenStoreSubscriptionManagement()` true on iOS too, ✅ `billingFlagKey()` (`apple_billing_enabled` on iOS, `play_billing_enabled` elsewhere), ✅ `billingPlatform()`. Still to do, with the Plans wiring: `if (isNative && isIOS) return appleBackend();` in `getBillingBackend()` and `verifyStorePurchase()` (iOS invokes `verify-apple-purchase` with `{ transactionId, productId, accountId }`). Update the "iOS is null" identity test.
2. ✅ `usePurchaseFlow.js`: pass `accountId` to `queryOwnedPurchases`; report `backend.productIds` and a store-neutral message instead of `PLAY_PRODUCT_IDS` / `play_catalogue_empty` (Android messages unchanged). Also: the mount restore now waits for `accountId`, which fixes an Android case too (restore before the account resolved spent the one-shot restore on a refused verification that rendered PENDING).
3. `Plans.jsx`: `useFeatureFlag(billingFlagKey())`; `verifyPurchase` delegates to `verifyStorePurchase`; `storeManaged` compares against the platform's own source; an account whose source is the OTHER store gets no purchase control.
4. `PurchaseAction.jsx`: two strings name "Google Play"; on iOS they must name the App Store (also 2.3.10: no other platforms in an iOS app). Copy-only change, Playbook: copywriter → frontend-design.
5. `VerifyingBanner` / `purchaseMachine`: PENDING from the sheet (Ask to Buy, nothing charged) and PENDING from verification (charged, late) share one sentence that is only true for the second.
6. ✅ `MyPlan.jsx`: store row from `managementCopy(source, platform)` in `src/lib/billing/storeManagement.js`, all six store × phone combinations tested. **Also fixes a latent 2.3.10 issue:** a Google subscriber opening the iPhone app used to read "Google Play" and "אנדרואיד"; the other phone now gets one neutral sentence in both directions.
7. ✅ `VehicleCapReachedModal.jsx`: `billingFlagKey()`.
8. `billingGate.js`, proposed diff (D6):

```diff
 export function capWallAction(kind, opts = {}) {
   ...
-  if (isAndroid) return { cta: iapReady ? 'plan' : null, mayMentionPlans: true };
-  return { cta: null, mayMentionPlans: false };
+  if (isAndroid) return { cta: iapReady ? 'plan' : null, mayMentionPlans: true };
+  // iOS: our own plans may be named, and the StoreKit sheet offered, only
+  // while a sheet can actually open. Naming a plan the app cannot sell is
+  // the hint at an outside purchase 3.1.1(a) forbids.
+  if (isIOS) return { cta: iapReady ? 'plan' : null, mayMentionPlans: iapReady };
+  return { cta: null, mayMentionPlans: false };
 }

-export function mayMentionPaidPlans() {
+export function mayMentionPaidPlans(opts = {}) {
   const surface = billingSurface();
   if (surface === WEB) return true;
-  if (surface === IAP) return isAndroid;
+  if (surface === IAP) return isAndroid || (isIOS && opts.iapReady === true);
   return false;
 }
```

Why per iapReady and not per build like Android: Play's rule is about the Billing library being in the binary (the "hybrid"). Apple's is about what the user is told: once our subscriptions are purchasable in the app, naming them is ordinary; before that, naming a plan the app cannot sell points outside it. `canReferToWeb()` and `canMentionExternalPurchase()` stay false on iOS either way.

## 5. Slice 2b: /Plans wired for iOS (`feat/apple-iap-plans`)

Built on the redesign after Ofek approved it. Defaults taken when the three questions were dismissed, each overrulable: build now on the redesign; on iOS name plans only when a sheet can open (D6); never offer a second store's purchase (D9).

| Piece | What changed |
|---|---|
| `lib/billing/index.js` | `getBillingBackend()` returns the Apple singleton on iOS |
| `lib/billing/verify.js` | `verifierFor(store)`: Apple → `verify-apple-purchase` with `transactionId`, Play unchanged; one stable function per store |
| `lib/billing/storeCopy.js` | every store-naming sentence, per store; Google strings byte-identical and pinned |
| `purchaseMachine` | new `DEFERRED` state for a store-pending purchase (Ask to Buy). PENDING stays "charged, activation late". Unreachable on Android |
| `PurchaseAction` | `store` prop; DEFERRED inline in `C.infoDark` with "בדוק שוב"; Terms + Privacy links under the renewal disclosure on every store (3.1.2) |
| `Plans.jsx` | `billingFlagKey()`; `verifierFor`; `isStoreManaged` covers both stores (no cross-store double purchase); `noteVoice` keeps Google out of an iPhone |
| `billingGate` | iOS CTA and plan mentions follow `iapReady` (D6) |
| `MyPlan` | passes `iapReady` to `mayMentionPaidPlans` |

Playbook: ux (deferred inline, not a banner), designer (`C.infoDark`, inline links with `py-3` for a 37px hit area on an 18px line), copywriter, frontend-design, qa (GO for staging). Verified in `/dev/components` at 375px: every App Store state, the deferred line, the links. `/Plans` renders as a guest with no JS errors.

### Known issues before App Review, none blocking a merge

1. 🔴 **`TermsOfService` has no subscription terms at all.** Apple requires the Terms link in the purchase flow and in the listing, and the page it points to must cover auto-renewal, price, cancellation. Legal text is Ofek's to approve.
2. Device-only: the StoreKit sheet, cancellation on a Hebrew device, Ask to Buy, `manageSubscriptions`, and that the plugin compiles and registers (Podfile, slice 2a).
3. After switching plans in Apple's page, /Plans updates within the 60-second `useAccountPlan` staleTime, not instantly.

### Restore Purchases control (added after the App Review notes exposed its absence)

`RestoreControl` below the plan list on /Plans, both stores, whenever `offering && !isGuest` (subscribers included: it is how a second phone recovers), hidden during SHEET_OPEN and VERIFYING. A tap passes `manual: true`: on iOS `queryOwnedPurchases(..., { sync: true })` calls the plugin's `restorePurchases()` (`AppStore.sync`) first, which may show Apple's sign-in; the automatic mount restore never does. `usePurchaseFlow.restore()` now returns 'restored' | 'none' | 'error' and catches a failed store query instead of leaking an unhandled rejection. Verified in /dev/components at 375px: 44px target, reserved 18px message line, none / error / offline.

### Pre-merge review (independent reviewer + own pass), all fixed

| Sev | Finding | Fix |
|---|---|---|
| High | One Apple ID, two of our accounts: B pays, gets `held_by_other_account`, the renewal hands the plan back to A | Owner = Apple's latest signed `appAccountToken` (`resolveAppleAccount`, `ownerToken`); old holder released after the new grant (`releaseHolders`) in both functions |
| High | Android restore credits another account's Google subscription | **Play session's** (feat/plans-edge-cases): server `account_mismatch` + device filter. Client maps it (and Apple's equivalents) to `not_yours` → IDLE, never PENDING |
| Medium | ASN read a DB error as "no account"/"not current" and answered 200, so Apple never retried | every DB error → 500 |
| Low | Restore spinner had no ceiling | 30s in RestoreControl |
| Low | "בדוק שוב" from DEFERRED/PENDING finding nothing put the buy button back | the waiting state survives "none" |
| Low | A failed AppStore.sync skipped the local entitlements | read anyway; error only when nothing is found |
| Low | Legal links pressable mid-verification | hidden while locked |
| Low | Restore before accountId answered "nothing found" | control waits for the account |
| Medium | iOS purchase returning another account's existing subscription rendered PENDING | FAILED ("not charged"), which is true: nothing new was bought |
| (found in own gatekeeper pass) | An expiry revoked only the account Apple names, leaving an earlier owner of a moved subscription on a paid plan | every iap_apple row naming the subscription is revoked; and `otherHolders` never filters on an empty uuid, which Postgres rejects (22P02) |
