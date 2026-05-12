#!/usr/bin/env bash
# ios-release-simulator.sh — reproduce TestFlight build mode locally on an iOS Simulator.
#
# Why this exists:
#   `ionic capacitor run ios -l --external` (or Xcode "Run") builds Debug and serves
#   from a dev server. That's NOT what TestFlight users get. Many bugs only appear
#   in a Release-config archive — minification, tree-shaking, splash storyboard
#   compile, plist-to-binary, asset catalog compile, etc.
#
#   This script builds the iOS app in Release configuration, installs it into a
#   simulator, launches it, and tails the device log — the closest reproduction
#   of TestFlight behavior we can get without a real device.
#
# Prereqs (Mac only):
#   - Xcode 26.x with iOS 26 SDK
#   - Node 22 + npm
#   - CocoaPods 1.15+
#
# Usage:
#   ./scripts/ios-release-simulator.sh                    # iPhone 16, latest iOS (default)
#   ./scripts/ios-release-simulator.sh "iPhone 11"        # iPhone 11
#   IOS_CONFIG=Debug ./scripts/ios-release-simulator.sh   # Debug build for comparison
#   SKIP_BUILD=1 ./scripts/ios-release-simulator.sh       # use last build, just relaunch
#
# What this script does NOT do:
#   - Code signing (sim builds don't need it).
#   - TestFlight upload (use the GitHub Actions workflow).
#   - Real-device testing (use ios-release.yml + TestFlight).

set -euo pipefail

# ───── Config ────────────────────────────────────────────────────────
SIM_DEVICE="${1:-iPhone 16}"
SIM_OS="${SIM_OS:-latest}"
IOS_CONFIG="${IOS_CONFIG:-Release}"   # Release matches TestFlight; override via env
BUNDLE_ID="${BUNDLE_ID:-com.carreminders.app}"
SCHEME="App"
WORKSPACE="ios/App/App.xcworkspace"
DERIVED_DATA="$PWD/build/ios-sim"

# ───── Pre-flight ────────────────────────────────────────────────────
echo "═══ iOS Simulator Release Build ═══"
echo "  Configuration : $IOS_CONFIG"
echo "  Device        : $SIM_DEVICE"
echo "  iOS           : $SIM_OS"
echo "  Bundle ID     : $BUNDLE_ID"
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: This script must run on macOS (Mac with Xcode)." >&2
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "ERROR: xcodebuild not found. Install Xcode."; exit 1; }
command -v xcrun      >/dev/null || { echo "ERROR: xcrun not found."; exit 1; }
command -v pod        >/dev/null || { echo "ERROR: cocoapods not found. \`gem install cocoapods\`"; exit 1; }
command -v npx        >/dev/null || { echo "ERROR: npx not found. Install Node 22."; exit 1; }

# ───── Build web assets in production mode ───────────────────────────
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "▶ Installing JS deps (npm ci)..."
  npm ci

  echo "▶ Building production web bundle..."
  npm run build

  echo "▶ Verifying dist/index.html exists..."
  test -f dist/index.html || { echo "ERROR: dist/index.html missing after npm run build"; exit 1; }

  echo "▶ Syncing to iOS (npx cap sync ios)..."
  npx cap sync ios

  echo "▶ Verifying ios/App/App/public/index.html exists..."
  test -f ios/App/App/public/index.html || {
    echo "ERROR: cap sync did not copy the web bundle."
    exit 1
  }

  echo "▶ Verifying public bundle is fresh..."
  diff -q dist/index.html ios/App/App/public/index.html >/dev/null 2>&1 \
    && echo "  ✓ public/index.html matches dist/index.html" \
    || { echo "✗ public/index.html DIFFERS from dist/index.html — cap sync stale"; exit 1; }

  echo "▶ Installing CocoaPods..."
  ( cd ios/App && pod install )
fi

# ───── Pick simulator ─────────────────────────────────────────────────
echo "▶ Resolving simulator UDID for '$SIM_DEVICE'..."
SIM_LINE=$(xcrun simctl list devices available 2>/dev/null \
  | grep -E "^\s*$SIM_DEVICE\b" \
  | grep -v "unavailable" \
  | head -n1 || true)

if [[ -z "$SIM_LINE" ]]; then
  echo "✗ No available simulator matched '$SIM_DEVICE'."
  echo "Available simulators:"
  xcrun simctl list devices available | grep -E "^\s*iPhone" | head -20
  exit 1
fi

SIM_UDID=$(echo "$SIM_LINE" | sed -E 's/.*\(([-A-F0-9]+)\).*/\1/')
echo "  ✓ UDID: $SIM_UDID"

# ───── Boot simulator ────────────────────────────────────────────────
SIM_STATE=$(xcrun simctl list devices | grep "$SIM_UDID" | sed -E 's/.*\((Booted|Shutdown).*$/\1/')
if [[ "$SIM_STATE" != "Booted" ]]; then
  echo "▶ Booting simulator..."
  xcrun simctl boot "$SIM_UDID"
fi

open -a Simulator --args -CurrentDeviceUDID "$SIM_UDID" >/dev/null 2>&1 || true

# ───── Build for simulator in Release ────────────────────────────────
echo "▶ Building $SCHEME ($IOS_CONFIG) for iOS Simulator..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$IOS_CONFIG" \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SIM_UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  build \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  | xcpretty || (echo "✗ Build failed"; exit 1)

# ───── Locate the .app bundle ────────────────────────────────────────
APP_PATH=$(find "$DERIVED_DATA/Build/Products" -name "App.app" -type d | head -n1)
if [[ -z "$APP_PATH" ]]; then
  echo "✗ Could not locate App.app in $DERIVED_DATA/Build/Products"
  exit 1
fi
echo "  ✓ App: $APP_PATH"

# Verify the embedded web bundle made it into the .app
if [[ ! -f "$APP_PATH/public/index.html" ]]; then
  echo "✗ index.html missing from embedded .app — Capacitor sync broken"
  exit 1
fi
echo "  ✓ Embedded public/index.html present in .app"

# ───── Install + launch ──────────────────────────────────────────────
# Uninstall first to match the fresh-install TestFlight scenario as closely
# as possible — clears WKWebView storage, IndexedDB, Cookies, and any
# previously-cached web bundle. Single subsequent install lands clean.
echo "▶ Uninstalling old data (matches fresh-install TestFlight)..."
xcrun simctl uninstall "$SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true

echo "▶ Installing on simulator..."
xcrun simctl install "$SIM_UDID" "$APP_PATH"

echo "▶ Launching $BUNDLE_ID..."
xcrun simctl launch --console-pty "$SIM_UDID" "$BUNDLE_ID"

# ───── Tail device logs ──────────────────────────────────────────────
# If the launch returned (the user closed the console), offer a follow-up tail.
echo
echo "═══ App launched. To stream logs again, run: ═══"
echo "  xcrun simctl spawn $SIM_UDID log stream \\"
echo "    --predicate 'processImagePath ENDSWITH \"/App\"' --level=debug"
echo
echo "Useful follow-ups:"
echo "  • Compare Release vs Debug:"
echo "      IOS_CONFIG=Debug ./scripts/ios-release-simulator.sh \"$SIM_DEVICE\""
echo "  • Inspect WKWebView console (only works in Debug):"
echo "      Safari > Develop > Simulator > [WebView]"
echo "  • Reset simulator state:"
echo "      xcrun simctl erase $SIM_UDID"
