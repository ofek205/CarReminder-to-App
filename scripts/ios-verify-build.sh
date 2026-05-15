#!/usr/bin/env bash
# ios-verify-build.sh — safe pre-archive diagnostics.
#
# Prints (without secrets) every fact about the build environment, repo
# state, and embedded iOS bundle that matters for "did this archive
# actually include what we think it includes?" debugging.
#
# Used by:
#   - .github/workflows/ios-release.yml as a pre-archive step.
#   - Local Mac runs before pushing a hotfix.
#
# Output is intentionally human-readable AND grep-able. Lines starting
# with "::" are GitHub Actions notice/warning markers.

set -uo pipefail   # NOT -e — we want to keep going past failed checks

FAIL=0
fail() { FAIL=1; echo "::error::$1"; }
warn() { echo "::warning::$1"; }
info() { echo "▸ $1"; }
ok()   { echo "  ✓ $1"; }

echo "═══ iOS Build Verification ═══"
echo "Date         : $(date -u +%FT%TZ)"
echo "OS           : $(uname -s) $(uname -r) $(uname -m)"
echo

# ─── Tooling ─────────────────────────────────────────────────────────
info "Tooling versions"
echo "  node         : $(node -v 2>/dev/null  || echo 'MISSING')"
echo "  npm          : $(npm -v 2>/dev/null   || echo 'MISSING')"
echo "  npx          : $(npx -v 2>/dev/null   || echo 'MISSING')"
echo "  pod          : $(pod --version 2>/dev/null || echo 'MISSING')"
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "  xcodebuild   : $(xcodebuild -version 2>/dev/null | head -n1 || echo 'MISSING')"
  echo "  iphoneos SDK : $(xcrun --sdk iphoneos --show-sdk-version 2>/dev/null || echo 'MISSING')"
  echo "  DEVELOPER_DIR: ${DEVELOPER_DIR:-<unset>}"
fi
echo

# ─── Repo state ──────────────────────────────────────────────────────
info "Repo state"
echo "  branch       : $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
echo "  commit       : $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "  dirty        : $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') files"
PKG_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')
echo "  pkg version  : $PKG_VERSION"
echo

# ─── Capacitor config ────────────────────────────────────────────────
info "Capacitor config"
if [[ -f capacitor.config.ts ]]; then
  WEBDIR=$(grep -oE "webDir:[[:space:]]*'[^']+'" capacitor.config.ts | head -n1 | sed -E "s/.*'([^']+)'/\1/")
  APPID=$(grep -oE "appId:[[:space:]]*'[^']+'" capacitor.config.ts | head -n1 | sed -E "s/.*'([^']+)'/\1/")
  echo "  appId        : $APPID"
  echo "  webDir       : $WEBDIR"
else
  fail "capacitor.config.ts missing"
fi
echo

# ─── Required env vars (presence only — never print values) ─────────
info "Required env vars (presence only)"
for var in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
  if [[ -n "${!var:-}" ]]; then
    LEN=${#var}
    VAL="${!var}"
    echo "  $var : present (len=${#VAL})"
  else
    fail "$var is MISSING — build will produce a broken bundle"
  fi
done
echo

# ─── npm run build outputs ───────────────────────────────────────────
info "Build output (dist/)"
if [[ -f dist/index.html ]]; then
  ok "dist/index.html exists"
  ASSETS_COUNT=$(find dist/assets -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "  assets       : $ASSETS_COUNT files"
  if [[ "$ASSETS_COUNT" -lt 5 ]]; then
    warn "Suspicious — only $ASSETS_COUNT files in dist/assets/"
  fi
else
  fail "dist/index.html missing — npm run build was not run, or failed"
fi
echo

# ─── Bundle-content env injection check ──────────────────────────────
# CRITICAL: this catches the iOS TestFlight failure mode where vite has
# the env vars in process.env (so a length-only check passes) but the
# bundle was somehow built WITHOUT them inlined — exactly the bug we hit
# on 3.0.2 (152): CI verify said "VITE_SUPABASE_URL : present (len=40)"
# but the iPhone's env-error UI fired anyway because the actual bundle
# did not contain the Supabase host string.
#
# This check is intentionally host-only — we never print or persist the
# secret URL itself. We extract just the host portion and grep for it.
info "Env injection (Supabase host inlined in dist bundle)"
if [[ -f dist/index.html && -n "${VITE_SUPABASE_URL:-}" ]]; then
  # Extract host (everything between https:// and the next /), then assert
  # at least one JS chunk in dist/assets references it.
  HOST=$(printf '%s' "$VITE_SUPABASE_URL" | sed -E 's|https?://([^/]+).*|\1|')
  if [[ -n "$HOST" ]] && grep -lq "$HOST" dist/assets/*.js 2>/dev/null; then
    ok "Supabase host inlined in dist/assets — vite resolved import.meta.env"
  else
    fail "Supabase host NOT in dist/assets/*.js — vite did NOT inline VITE_SUPABASE_URL despite it being in env. TestFlight WILL show env-error UI."
  fi
elif [[ -z "${VITE_SUPABASE_URL:-}" ]]; then
  echo "  (skipped — VITE_SUPABASE_URL not in shell)"
fi
echo

# ─── iOS native bundle ───────────────────────────────────────────────
info "iOS embedded bundle (ios/App/App/public/)"
if [[ -f ios/App/App/public/index.html ]]; then
  ok "ios/App/App/public/index.html exists"
  if [[ -f dist/index.html ]]; then
    if diff -q dist/index.html ios/App/App/public/index.html >/dev/null 2>&1; then
      ok "matches dist/index.html (cap sync up-to-date)"
    else
      fail "ios/App/App/public/index.html DIFFERS from dist/index.html — run \`npx cap sync ios\`"
    fi
  fi
  IOS_ASSETS=$(find ios/App/App/public/assets -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "  ios assets   : $IOS_ASSETS files"
  # Same host-only env-injection check against the SYNCED bundle that
  # actually ships in the IPA. cap sync should be a verbatim copy of
  # dist/, but we assert it here rather than trust by inference.
  if [[ -n "${VITE_SUPABASE_URL:-}" ]]; then
    IOS_HOST=$(printf '%s' "$VITE_SUPABASE_URL" | sed -E 's|https?://([^/]+).*|\1|')
    if [[ -n "$IOS_HOST" ]] && grep -lq "$IOS_HOST" ios/App/App/public/assets/*.js 2>/dev/null; then
      ok "Supabase host present in synced bundle (ios/App/App/public/assets)"
    else
      fail "Supabase host NOT in ios/App/App/public/assets/*.js — IPA will ship without env. TestFlight env-error UI guaranteed."
    fi
  fi
else
  fail "ios/App/App/public/index.html missing — \`npx cap sync ios\` did not run"
fi
echo

# ─── iOS native version metadata ─────────────────────────────────────
info "iOS marketing version + build number"
if [[ -f ios/App/App.xcodeproj/project.pbxproj ]]; then
  MV=$(grep -m1 "MARKETING_VERSION = " ios/App/App.xcodeproj/project.pbxproj | sed -E 's/.*MARKETING_VERSION = ([^;]+);/\1/' | tr -d ' ')
  CV=$(grep -m1 "CURRENT_PROJECT_VERSION = " ios/App/App.xcodeproj/project.pbxproj | sed -E 's/.*CURRENT_PROJECT_VERSION = ([^;]+);/\1/' | tr -d ' ')
  PB=$(grep -m1 "PRODUCT_BUNDLE_IDENTIFIER = " ios/App/App.xcodeproj/project.pbxproj | sed -E 's/.*PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/\1/' | tr -d ' ')
  DT=$(grep -m1 "IPHONEOS_DEPLOYMENT_TARGET = " ios/App/App.xcodeproj/project.pbxproj | sed -E 's/.*IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/\1/' | tr -d ' ')
  echo "  marketing ver: $MV"
  echo "  build number : $CV"
  echo "  bundle id    : $PB"
  echo "  min iOS      : $DT"
  if [[ "$PKG_VERSION" != "unknown" && "$PKG_VERSION" != "$MV" ]]; then
    warn "package.json version ($PKG_VERSION) does not match iOS MARKETING_VERSION ($MV)"
  fi
else
  fail "ios/App/App.xcodeproj/project.pbxproj missing"
fi
echo

# ─── Pods coherence ──────────────────────────────────────────────────
info "CocoaPods state"
if [[ -f ios/App/Podfile.lock ]]; then
  CAP_VER=$(grep -A1 "Capacitor (" ios/App/Podfile.lock | head -n1 | sed -E 's/.*Capacitor \(([^)]+)\).*/\1/')
  echo "  Capacitor pod: $CAP_VER"
else
  warn "ios/App/Podfile.lock missing — pod install never ran in this checkout"
fi
echo

# ─── Privacy manifest ────────────────────────────────────────────────
info "Privacy manifest"
if [[ -f ios/App/App/PrivacyInfo.xcprivacy ]]; then
  ok "PrivacyInfo.xcprivacy exists"
else
  warn "PrivacyInfo.xcprivacy missing — App Store will warn"
fi
echo

# ─── Info.plist URL scheme + queries (deep-link sanity) ──────────────
#
# Catches two iOS-only regressions that bit production this cycle:
#
#   (a) CFBundleURLTypes missing the `carreminder` scheme — Google
#       Sign-In completed inside Safari but the callback to
#       `carreminder://auth/callback` failed with "Safari cannot open
#       the page because the address is invalid" because iOS did not
#       know the scheme belonged to us. v4.4.3 hotfix.
#
#   (b) LSApplicationQueriesSchemes missing `waze` / `comgooglemaps` —
#       FindGarage's "ניווט" buttons silently no-op on iOS because
#       UIApplication.canOpenURL: returns false without the
#       declaration.
#
# Both are static plist entries that have no runtime check until
# users hit them. Surfacing the absence here makes every archive
# self-verify before the IPA ships.
info "Info.plist deep-link declarations"
INFO_PLIST="ios/App/App/Info.plist"
if [[ -f "$INFO_PLIST" ]]; then
  # CFBundleURLTypes → carreminder scheme (required for OAuth callback).
  if grep -q "<key>CFBundleURLTypes</key>" "$INFO_PLIST" \
     && grep -A 30 "<key>CFBundleURLTypes</key>" "$INFO_PLIST" \
        | grep -q "<string>carreminder</string>"; then
    ok "CFBundleURLTypes registers carreminder:// scheme"
  else
    fail "Info.plist is missing CFBundleURLTypes / carreminder scheme — Google Sign-In will fail on iOS with 'Safari cannot open the page' (see v4.4.3 commit message for context)"
  fi
  # LSApplicationQueriesSchemes → waze + comgooglemaps (FindGarage nav buttons).
  if grep -q "<key>LSApplicationQueriesSchemes</key>" "$INFO_PLIST"; then
    SCHEMES_BLOCK=$(awk '/<key>LSApplicationQueriesSchemes<\/key>/,/<\/array>/' "$INFO_PLIST")
    if echo "$SCHEMES_BLOCK" | grep -q "<string>waze</string>"; then
      ok "LSApplicationQueriesSchemes includes waze"
    else
      warn "LSApplicationQueriesSchemes missing 'waze' — FindGarage Waze nav button will no-op on iOS"
    fi
    if echo "$SCHEMES_BLOCK" | grep -q "<string>comgooglemaps</string>"; then
      ok "LSApplicationQueriesSchemes includes comgooglemaps"
    else
      warn "LSApplicationQueriesSchemes missing 'comgooglemaps' — FindGarage Google Maps nav button will no-op on iOS"
    fi
  else
    warn "Info.plist is missing LSApplicationQueriesSchemes — FindGarage nav buttons (Waze, Google Maps) will silently no-op on iOS"
  fi
else
  fail "$INFO_PLIST missing — every iOS check below this is meaningless"
fi
echo

# ─── Summary ─────────────────────────────────────────────────────────
echo "═══ Summary ═══"
if [[ "$FAIL" -eq 0 ]]; then
  echo "✓ All required checks passed."
  exit 0
else
  echo "✗ One or more required checks failed (see ::error:: lines above)."
  exit 1
fi
