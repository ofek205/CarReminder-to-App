# Android App Links verification

This folder contains `assetlinks.json`, which Android uses to verify that
`https://car-reminder.app/*` URLs should open directly in the CarReminder
app instead of the browser.

## What you need to do once, before enabling verification

1. **Get the upload cert fingerprint** (the keystore you used to sign the AAB):
   ```bash
   keytool -list -v -keystore path/to/upload-keystore.jks -alias <your-alias>
   ```
   Copy the `SHA256` line (the long colon-separated string).

2. **Get the Play App Signing cert fingerprint** (Google re-signs your app):
   - Go to Play Console → your app → Setup → App signing
   - Copy the "SHA-256 certificate fingerprint" under "App signing key certificate"

3. **Paste both fingerprints** into `assetlinks.json` replacing the two
   `REPLACE_WITH_*` placeholders. Keep them as separate entries in the array —
   Android accepts either.

4. **Deploy** (Vercel). Verify the file is served:
   ```
   curl https://car-reminder.app/.well-known/assetlinks.json
   ```
   It must return HTTP 200 with `Content-Type: application/json` and the JSON above.

5. **Flip `autoVerify="true"`** in `android/app/src/main/AndroidManifest.xml` for
   the `https` intent-filter (currently set to `false` so unverified installs
   still show the "open with" picker).

6. **Verify in ADB** after install:
   ```bash
   adb shell pm get-app-links com.carreminder.app
   ```
   Should show `car-reminder.app: verified`.

## Why two fingerprints?

Google Play Play-signs your app with a different key than the one you upload
with. Users installing from Play see the Play-signing fingerprint; users
side-loading see the upload fingerprint. Both entries make deep-links work
in both scenarios.

---

# iOS Universal Links verification

`apple-app-site-association` is the iOS counterpart of `assetlinks.json`.
Until 2026-09-16 it did not exist at all: the URL returned 404, which means
**no https link has ever opened the iOS app**, for any user, since launch.
The Android side was finished and verified; this half was never built.

Serving rules Apple enforces, all three of which this repo now satisfies:

- The path is exactly `/.well-known/apple-app-site-association`, with **no
  file extension**. A `.json` suffix is not accepted.
- It must be served as `application/json`. A file with no extension would
  otherwise go out as `application/octet-stream`, so `vercel.json` carries
  an explicit `Content-Type` header for this path.
- It must be reachable over https with **no redirect**. The SPA rewrite in
  `vercel.json` already excludes `.well-known`, so the file is served as
  itself rather than rewritten to `index.html`.

The `appIDs` entry is `<TEAM_ID>.<BUNDLE_ID>`. Note that the two platforms
do **not** share a bundle id: Android is `com.carreminder.app` and iOS is
`com.carreminders.app`, with an s. Copying one into the other is silent —
the file stays valid JSON and association simply never happens.

## ⚠️ This file alone does nothing. The app half is still missing.

A Universal Link needs BOTH sides. The app must declare the domain, and
`ios/App/App/App.entitlements` currently has no
`com.apple.developer.associated-domains` key.

**Do these two in order. The order matters.**

1. In the Apple Developer portal, enable the **Associated Domains**
   capability for App ID `com.carreminders.app`, then regenerate the
   provisioning profile.
2. Only then add to `App.entitlements`:

   ```xml
   <key>com.apple.developer.associated-domains</key>
   <array>
     <string>applinks:car-reminder.app</string>
   </array>
   ```

Doing step 2 first **breaks the build**: signing fails with "Provisioning
profile doesn't include the com.apple.developer.associated-domains
entitlement", and the iOS release workflow has never compiled successfully
even once, so a signing failure would be hard to tell apart from the
Swift errors everyone is expecting.

## Checking it worked

```bash
curl -sI https://car-reminder.app/.well-known/apple-app-site-association
# expect: HTTP/2 200 and content-type: application/json
```

Apple's CDN caches this file. After the app ships with the entitlement,
first install fetches it directly; later changes can take up to 24 hours
to propagate.
