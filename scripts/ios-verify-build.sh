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

# ─── Summary ─────────────────────────────────────────────────────────
echo "═══ Summary ═══"
if [[ "$FAIL" -eq 0 ]]; then
  echo "✓ All required checks passed."
  exit 0
else
  echo "✗ One or more required checks failed (see ::error:: lines above)."
  exit 1
fi
