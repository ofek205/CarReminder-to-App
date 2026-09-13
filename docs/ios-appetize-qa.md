# iOS Appetize QA (browser iPhone simulator)

**Status (2026-09-13):** operator runbook for `.github/workflows/ios-appetize-qa.yml`. This path is **pre-store QA only**. It does not sign an IPA, does not talk to App Store Connect, and does not replace [IOS_RELEASE_CHECKLIST.md](./IOS_RELEASE_CHECKLIST.md) / `ios-release.yml`.

**Audience:** Ofek. You add two GitHub secrets and click Run workflow. Claude does not hold the Appetize token and does not merge this to customers.

---

## What this is

The workflow builds the Capacitor iOS app the same way the local simulator script does (`ios/App/App.xcworkspace`, scheme `App`, CocoaPods), but as **Debug for `iphonesimulator` with signing off**. It zips `App.app` and uploads it to [Appetize.io](https://appetize.io). Appetize streams a hosted iOS Simulator in the browser.

Appetize **cannot** run a device-signed `.ipa`. That is why this job is unsigned-simulator on purpose.

| Path | What you get |
|---|---|
| This workflow | Browser URL to tap through the iPhone app |
| `ios-release.yml` | Signed Release → TestFlight / App Store |
| `scripts/ios-release-simulator.sh` | Same simulator binary, on a Mac you already have |

---

## One-time setup (about 10 minutes)

### 1. Create a free Appetize account

1. Open <https://appetize.io> and sign up (email is enough).
2. Confirm the inbox link if they send one.
3. The free plan is enough to start. Minutes / concurrent sessions are limited; treat this as a QA link, not a public demo farm.

### 2. Create an API token

1. In the Appetize dashboard: **Organization → API Tokens**.
2. **Generate API Token**. Label it something like `github-car-reminder-ios-qa`.
3. Pick the least-privileged role that can upload apps (Developer is enough if offered).
4. **Copy the token immediately.** Appetize shows the full value once.

Docs: <https://docs.appetize.io/account/api-tokens>

### 3. Put the secrets on GitHub

Repo: <https://github.com/ofek205/CarReminder-to-App>

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required? | What to paste |
|---|---|---|
| `APPETIZE_API_TOKEN` | **Yes** | The token from step 2 |
| `APPETIZE_PUBLIC_KEY` | After first upload | The `publicKey` printed in the workflow summary |
| `VITE_SUPABASE_URL` | Yes (already used by iOS/Android CI) | Same value as `ios-release.yml` |
| `VITE_SUPABASE_ANON_KEY` | Yes (already used) | Same value as `ios-release.yml` |

Without the two `VITE_*` secrets the web bundle bakes `undefined` into Supabase and the hosted app sits on the green splash. That is the same trap as a broken TestFlight build.

Leave `APPETIZE_PUBLIC_KEY` empty for the first run. After the job succeeds, the summary shows the key and the URL. Paste the key into that secret so every later run **updates the same app** and the URL stays `https://appetize.io/app/<that-key>`.

### 4. Run the workflow by hand

1. GitHub → **Actions** → **iOS Appetize QA**.
2. **Run workflow**.
3. Pick the branch you want to QA (usually `staging`, or this PR branch).
4. Optional **note** field is only a label on the Appetize dashboard.
5. Wait for the macOS job (first run is the slow one: `npm ci` + `pod install` + `xcodebuild`).
6. Open the job **Summary**. The Appetize URL is at the top. The same zip is attached as the `App-iphonesimulator` artifact if you want a local copy.

If you click **Run workflow** and `APPETIZE_API_TOKEN` is missing, the upload step fails with a pointer back to this page (the simulator zip is still an artifact). On a `pull_request` run the same missing token **skips** the upload instead of failing the check, so this workflow can merge before the secret exists.

---

## When it also runs by itself

`pull_request` is wired, but only when these paths change:

- `ios/**`
- `capacitor.config.ts`

Everyday web PRs that only touch `src/` do **not** start a macOS runner, and edits to this workflow file alone do not either (run it by hand). That is deliberate — hosted macOS minutes are the expensive ones.

---

## What the job actually builds

Verified in this repo (not guessed):

- Workspace: `ios/App/App.xcworkspace` (includes `App.xcodeproj` and `Pods/Pods.xcodeproj` after `pod install`)
- Scheme / product: `App` → `App.app` (`com.carreminders.app`)
- Integration: CocoaPods via `ios/App/Podfile`. `CapApp-SPM` is present but is not the CI archive path (same decision as `ios-release.yml`).
- Flags: `-sdk iphonesimulator`, `CODE_SIGNING_ALLOWED=NO` (plus identity empty / required=NO). No certificates, no provisioning profiles.

Current Appetize upload API (v1, 2026-09): `POST https://api.appetize.io/v1/apps` or `.../apps/{publicKey}` with header `X-API-KEY` and multipart field `file`. Older Basic-auth examples you may find online are stale.

---

## After you have a URL

- Anyone with the link can run the app (`appPermissions.run=public` is set so you do not have to stay logged into Appetize). Treat the URL like a TestFlight link, not a landing-page embed, until you decide otherwise.
- Push / camera / Sign in with Apple will not behave like a real device. Use TestFlight for those.
- If the hosted app is a green spinner, the usual cause is missing `VITE_SUPABASE_*` in the Actions secrets, not Appetize itself.

---

## Out of scope on purpose

- No `git push` to `main`, no store signing, no `npx cap` from this runbook.
- No change to `ios-release.yml` certificates or App Store Connect keys.
- Claude does not create the Appetize account or store the token.
