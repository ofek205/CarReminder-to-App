# Android App Links verification

This folder contains `assetlinks.json`, which Android uses to verify that
`https://carreminder.co.il/*` URLs should open directly in the CarReminder
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
   curl https://carreminder.co.il/.well-known/assetlinks.json
   ```
   It must return HTTP 200 with `Content-Type: application/json` and the JSON above.

5. **Flip `autoVerify="true"`** in `android/app/src/main/AndroidManifest.xml` for
   the `https` intent-filter (currently set to `false` so unverified installs
   still show the "open with" picker).

6. **Verify in ADB** after install:
   ```bash
   adb shell pm get-app-links com.carreminder.app
   ```
   Should show `carreminder.co.il: verified`.

## Why two fingerprints?

Google Play Play-signs your app with a different key than the one you upload
with. Users installing from Play see the Play-signing fingerprint; users
side-loading see the upload fingerprint. Both entries make deep-links work
in both scenarios.
