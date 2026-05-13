#!/usr/bin/env node
/**
 * update-sw-version — keeps `public/sw.js`'s CACHE_VERSION in sync with
 * `package.json`'s version on every build.
 *
 * Why this exists:
 *   The Service Worker's CACHE_VERSION constant gates which cached
 *   shells / assets get purged on the next browser visit. If it isn't
 *   bumped when Vite emits new chunk hashes, returning users hit the
 *   stale cache → blank screen / wrong assets. The previous workflow
 *   was "remember to bump cr-vX-Y-Z manually" which was inevitably
 *   forgotten on some releases.
 *
 *   This script runs as a `prebuild` step (see package.json scripts)
 *   and rewrites the CACHE_VERSION line based on package.json's version.
 *   Any change shows up in `git status` after `npm run build`, so the
 *   bump is visible and committable.
 *
 * Idempotent: if CACHE_VERSION already matches package.json, no file
 * write happens — keeps git clean on no-op builds.
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const PKG_PATH  = path.join(ROOT, 'package.json');
const SW_PATH   = path.join(ROOT, 'public', 'sw.js');

const pkg     = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const version = String(pkg.version || '').trim();
if (!version) {
  console.error('[sw-version] package.json has no version field — skipping');
  process.exit(0);
}

// Derive the cache identifier. Replace dots with dashes so the value is
// safe inside a string-prefix used as the cache key (no surprises with
// regex / globbing tools). Example: 4.1.0 → cr-v4-1-0.
const desired = `cr-v${version.replace(/\./g, '-')}`;

const sw = fs.readFileSync(SW_PATH, 'utf8');

// Match the CACHE_VERSION declaration. The constant value is a string
// literal (single or double-quoted). The regex captures the existing
// value so we can short-circuit when it already matches.
const re = /(const\s+CACHE_VERSION\s*=\s*['"])([^'"]+)(['"];)/;
const match = sw.match(re);
if (!match) {
  console.error('[sw-version] could not find CACHE_VERSION line in public/sw.js — skipping');
  process.exit(0);
}

const current = match[2];
if (current === desired) {
  console.log(`[sw-version] already up-to-date (${current})`);
  process.exit(0);
}

const next = sw.replace(re, `$1${desired}$3`);
fs.writeFileSync(SW_PATH, next, 'utf8');
console.log(`[sw-version] bumped ${current} → ${desired}`);
