#!/usr/bin/env bash
# =============================================================================
# check-android-permissions.sh
#
# Hard guard against the Google Play "Invalid use of permissions for photos
# and videos" rejection. Scans the MERGED Android manifest (after Gradle's
# manifest merger has folded in every library's permissions, including
# @capacitor/camera) and fails the build if any of the broad media
# permissions reappear.
#
# Background: our own AndroidManifest.xml explicitly strips these via
# tools:node="remove". But a library update can re-introduce them — and
# the failure mode is silent until Google Play rejects the upload weeks
# later. Running this in CI between `gradlew assembleDebug` and the
# artifact upload catches the regression at build time, before any
# bytes leave the runner.
#
# Usage (CI):
#   bash scripts/check-android-permissions.sh
#
# Usage (local, after a debug build):
#   cd android && ./gradlew assembleDebug
#   cd .. && bash scripts/check-android-permissions.sh
#
# Exit codes:
#   0  — manifest is clean, no forbidden permissions found
#   1  — at least one forbidden permission is present (build should fail)
#   2  — merged manifest not found (build hasn't run, or paths changed)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Permissions Google Play rejects under the May 2024 "photos and videos"
# policy for apps that use photos only occasionally. Keep this list in
# sync with android/app/src/main/AndroidManifest.xml — every entry here
# must also be removed there via tools:node="remove".
FORBIDDEN=(
  "android.permission.READ_MEDIA_IMAGES"
  "android.permission.READ_MEDIA_VIDEO"
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
)

# Try both common Gradle output paths. Capacitor 8 + AGP 8.x usually
# puts the merged manifest under merged_manifests/<variant>/processed/
# but older layouts use packaged_manifests/. We search both.
MERGED_PATHS=(
  "android/app/build/intermediates/merged_manifests/debug/processed/AndroidManifest.xml"
  "android/app/build/intermediates/merged_manifests/debug/AndroidManifest.xml"
  "android/app/build/intermediates/packaged_manifests/debug/AndroidManifest.xml"
  "android/app/build/intermediates/merged_manifests/release/processed/AndroidManifest.xml"
  "android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml"
  "android/app/build/intermediates/packaged_manifests/release/AndroidManifest.xml"
)

MANIFEST=""
for p in "${MERGED_PATHS[@]}"; do
  if [ -f "$p" ]; then
    MANIFEST="$p"
    break
  fi
done

if [ -z "$MANIFEST" ]; then
  # As a last resort, glob anywhere under intermediates/ for any merged
  # manifest. This survives future AGP path changes without us having
  # to chase the canonical name in this script.
  MANIFEST="$(find android/app/build/intermediates -name AndroidManifest.xml -path '*merged*' 2>/dev/null | head -1 || true)"
fi

if [ -z "$MANIFEST" ] || [ ! -f "$MANIFEST" ]; then
  echo "ERROR: merged AndroidManifest.xml not found. Did Gradle build run?"
  echo "  Searched:"
  for p in "${MERGED_PATHS[@]}"; do echo "    - $p"; done
  exit 2
fi

echo "Scanning merged manifest: $MANIFEST"
echo ""

FOUND_FORBIDDEN=0
for perm in "${FORBIDDEN[@]}"; do
  # Match the permission name inside a uses-permission tag. We use
  # fgrep on the literal string — the manifest is XML so the permission
  # name will be either in android:name="..." or just bare.
  if grep -F "$perm" "$MANIFEST" > /dev/null 2>&1; then
    echo "❌ FORBIDDEN permission found: $perm"
    grep -n "$perm" "$MANIFEST" | head -3
    FOUND_FORBIDDEN=1
  else
    echo "✓ clean: $perm"
  fi
done

echo ""
if [ "$FOUND_FORBIDDEN" -ne 0 ]; then
  cat <<'EOF'

═════════════════════════════════════════════════════════════════════
BUILD BLOCKED — Google Play policy violation imminent.

A broad media permission has re-appeared in the merged Android
manifest. If this AAB is uploaded as-is, Google Play will reject it
under the May 2024 "photos and videos" policy.

Why this happened:
  - Our app's AndroidManifest.xml is configured to strip these
    permissions via tools:node="remove", so this scan failing
    means a LIBRARY just started declaring them.
  - Most likely cause: a recent npm update to @capacitor/camera
    or another media-touching plugin.

How to fix:
  1. Confirm which library re-introduced the permission. Search
     node_modules/<plugin>/android/.../AndroidManifest.xml for the
     forbidden name.
  2. If the library is essential, add another tools:node="remove"
     entry in android/app/src/main/AndroidManifest.xml. The list at
     the top of this script is your source of truth — keep them in
     sync.
  3. Re-run the build and this scan should pass.
═════════════════════════════════════════════════════════════════════
EOF
  exit 1
fi

echo "✅ All forbidden permissions are stripped from the merged manifest."
echo "   AAB is safe to upload to Google Play."
exit 0
