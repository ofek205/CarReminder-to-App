# Apple Guideline 4.8 — Sign in with Apple Setup Guide

> Code changes for Sign in with Apple are already in place on this branch.
> But the button won't work until **all four** of these external services
> are configured. Do them in order — each step depends on the previous one.

## Why this exists

Apple App Review rejected v4.0.0 because the app offers Google Sign-In
but not an equivalent privacy-respecting alternative. Sign in with Apple
satisfies the requirement (limits data collection to name/email, allows
email hiding, no advertising tracking).

## Pre-flight

Open a terminal in the repo root and install the Capacitor plugin:

```bash
npm install
```

The plugin `@capacitor-community/apple-sign-in@^7.0.0` is already in
`package.json`. If `npm install` fails because of a Capacitor 8
incompatibility, install the latest matching version explicitly:

```bash
npm install @capacitor-community/apple-sign-in@latest
```

Then sync to iOS so Capacitor adds the CocoaPods entry:

```bash
npx cap sync ios
```

---

## Step 1 — Apple Developer Console (~10 min)

1. Go to <https://developer.apple.com/account/resources/identifiers/list>
2. Find your App ID — **`com.carreminders.app`** (the iOS bundle ID).
3. Click it → scroll to **Capabilities** → tick **Sign In with Apple**
   → click **Save**.
4. Confirm the dialog. (No `Edit` button needed; check the box and save.)

### Create the Services ID (web-side flow)

> Required by Supabase even if you only intend to sign in on iOS, because
> Supabase routes the identity exchange through its web callback.

5. Identifiers → click **+** → **Services IDs** → Continue.
6. Description: `CarReminder Web Auth`. Identifier: **`com.carreminders.app.signin`**.
   Click Continue → Register.
7. Click the new Services ID → tick **Sign In with Apple** → click
   **Configure** next to it.
8. **Primary App ID:** select `com.carreminders.app`.
9. **Domains and Subdomains:** `zuqvolqapwcxomuzoodu.supabase.co`
10. **Return URLs:** `https://zuqvolqapwcxomuzoodu.supabase.co/auth/v1/callback`
11. Save → Continue → Save the Services ID.

### Create the Sign In with Apple Key

12. Keys (left sidebar) → click **+**.
13. Name: `CarReminder Apple Sign In Key`. Tick **Sign In with Apple**.
14. Click **Configure** → select Primary App ID `com.carreminders.app`
    → Save.
15. Continue → Register.
16. **Download the `.p8` file NOW** — Apple shows it once. Stash it
    somewhere safe (e.g. 1Password). Note the **Key ID** (10 chars) shown
    on screen — you'll paste it into Supabase.

You also need your **Team ID** — find it at
<https://developer.apple.com/account/#MembershipDetailsCard> (top right
of any developer page). 10-character string.

---

## Step 2 — Supabase Dashboard (~5 min)

1. <https://supabase.com/dashboard/project/zuqvolqapwcxomuzoodu/auth/providers>
2. Find **Apple** in the provider list → click to expand → toggle **Enabled**.
3. Fill the form:
   - **Client IDs (Services IDs)**: `com.carreminders.app.signin,com.carreminders.app`
     (comma-separated. The `.signin` Services ID handles web; the bundle
     ID handles native iOS signInWithIdToken.)
   - **Secret Key (for OAuth)**: paste the contents of the `.p8` file
     you downloaded (yes, the whole file content, including the PEM
     header and footer lines that wrap the base64 body).
   - **Key ID**: 10-char ID from Step 1.16.
   - **Team ID**: 10-char Team ID.
4. Click **Save**.
5. Confirm that the Apple block now shows a green "Enabled" badge.

---

## Step 3 — Xcode Capability (~3 min, on macOS only)

1. Open `ios/App/App.xcworkspace` in Xcode.
2. Select the **App** target → **Signing & Capabilities** tab.
3. Click **+ Capability** (top-left of the tab).
4. Add **Sign in with Apple**.
5. Verify the team is your developer account; Xcode regenerates the
   provisioning profile automatically.
6. Build to a physical device to confirm the capability is wired:
   `Product → Build`. No need to actually run the sign-in flow yet —
   just confirm the build succeeds with no signing errors.

---

## Step 4 — Test Flow

1. After all three steps above, run `npm run build && npx cap sync ios`
   and rebuild the iOS app on a physical device.
2. Open the app (logged out). The auth screen now shows a **black
   "המשך עם Apple"** button above the white Google button.
3. Tap it. The native iOS Sign in with Apple sheet should appear (NOT
   a Safari window — that's the plugin doing its job).
4. Choose **Continue** or **Hide my email**. Complete with Face/Touch ID.
5. The sheet dismisses. The app should land on Dashboard within ~1 sec.
6. Verify in Supabase Dashboard → Authentication → Users that a new row
   appeared with provider `apple`.

### On Web

The web app at car-reminder.app uses `supabase.auth.signInWithOAuth({
provider: 'apple' })` — the Apple sign-in opens in a popup/redirect.
This is the fallback path; it doesn't need the Capacitor plugin and
will work as soon as Step 1 + Step 2 are complete.

---

## Common Errors

| Error message | Cause | Fix |
|---|---|---|
| `Provider not enabled` | Step 2 not saved | Re-save Apple provider in Supabase |
| `invalid_client` | Services ID mismatch | Step 2 client IDs must include both `.app.signin` AND `.app` |
| `Apple לא החזיר token תקין` | Native plugin called before `npx cap sync` | Re-run `cap sync ios`, rebuild |
| Native sheet appears but Supabase rejects | Wrong return URL | Verify Step 1.10 matches your project's URL exactly |
| Web flow redirects but session is empty | Cookies blocked / 3rd-party cookies in Safari | Use the native flow on iOS; on web, ensure the user isn't in private browsing |

---

## What's in the code already

- `package.json` — `@capacitor-community/apple-sign-in@^7.0.0` dependency
- `src/pages/AuthPage.jsx`:
  - `AppleIcon` SVG component (HIG-compliant Apple logo)
  - "המשך עם Apple" button in both pre-form and in-form locations (above
    Google in both, matching the "equivalent prominence" requirement)
  - `handleOAuth('apple')` branch:
    - **Native iOS**: calls `SignInWithApple.authorize(...)` → passes
      `identityToken` to `supabase.auth.signInWithIdToken({ provider:
      'apple' })`. Surfaces a friendly cancel/error UX.
    - **Web**: falls through to the standard `signInWithOAuth({ provider:
      'apple' })` flow — Supabase handles the rest.

No changes needed to Capacitor config or Info.plist — the plugin
auto-registers when `npx cap sync ios` runs.

## When you're done

Test the flow on a physical iPhone or iPad, capture a screen recording
of the native sheet appearing and the user landing on Dashboard, and
include that recording (or just describe the working flow) in your
App Review reply alongside the 1.2 recording.
