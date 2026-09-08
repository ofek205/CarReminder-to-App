/**
 * build-precache-manifest — lists every built asset the Service Worker should
 * pre-cache, so the app works offline on pages the user has not visited yet.
 *
 * WHY THIS EXISTS
 *
 * `public/sw.js` caches index.html together with the assets index.html
 * references. That is enough to BOOT offline, but the app code-splits per
 * route: this build emits 200 asset files while index.html names only 6. Every
 * page chunk (Documents, Accidents, Expenses, ...) is therefore cached only if
 * the user happened to open that page while online. Navigate offline to a page
 * you have not visited and the chunk is missing, Suspense hangs, and the
 * 8-second recovery reloads into the same failure.
 *
 * A Service Worker cannot list a directory, so the file names have to be handed
 * to it. This runs as `postbuild` (dist must already exist) and writes
 * dist/precache-manifest.json, which the worker fills into its asset cache in
 * the background after activating.
 *
 * EXCLUSIONS: the two export-only giants (exceljs ~918 KB, pdfExport ~583 KB,
 * 1.5 MB together). Spreadsheet and PDF export are deliberate desk actions, not
 * offline field work, and they stay runtime-cached if anyone does use them. The
 * remainder is ~4 MB, which is a reasonable resident cost for a PWA.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'dist', 'assets');
const OUT = path.join(ROOT, 'dist', 'precache-manifest.json');

// Matched against the file name. Keep this list short and justified.
const EXCLUDE = [/^exceljs/i, /^pdfExport/i];

if (!fs.existsSync(ASSETS_DIR)) {
  console.error('[precache] dist/assets missing — run after vite build. Skipping.');
  process.exit(0);   // never fail the build over this
}

const files = fs.readdirSync(ASSETS_DIR)
  .filter((f) => /\.(js|css|woff2?|ttf)$/.test(f))
  .filter((f) => !EXCLUDE.some((re) => re.test(f)));

let bytes = 0;
for (const f of files) bytes += fs.statSync(path.join(ASSETS_DIR, f)).size;

// Relative paths, matching how the worker resolves its other cache keys.
const list = files.map((f) => `./assets/${f}`).sort();
fs.writeFileSync(OUT, JSON.stringify(list, null, 0));

const skipped = fs.readdirSync(ASSETS_DIR).length - files.length;
console.log(`[precache] ${list.length} assets, ${(bytes / 1048576).toFixed(1)} MB (${skipped} excluded)`);
