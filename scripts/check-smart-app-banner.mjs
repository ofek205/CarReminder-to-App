/**
 * Post-build check for the iOS Smart App Banner.
 *
 * Every prerendered marketing page (dist/website/**\/index.html) must contain
 * the apple-itunes-app meta exactly once. The app shell (dist/index.html),
 * which the Capacitor app and the signed-in web routes also use, must not
 * contain it.
 *
 * Runs from postbuild, after vite has written dist. Does not edit
 * scripts/test-marketing.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const BANNER = '<meta name="apple-itunes-app" content="app-id=6764073107" />';
const root = path.resolve('dist');
const websiteDir = path.join(root, 'website');

async function indexFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await indexFiles(full));
    else if (entry.isFile() && entry.name === 'index.html') files.push(full);
  }
  return files;
}

let websitePages;
try {
  websitePages = await indexFiles(websiteDir);
} catch (error) {
  if (error && error.code === 'ENOENT') {
    console.error('Smart App Banner check: dist/website is missing. Run after vite build.');
    process.exit(1);
  }
  throw error;
}

assert.ok(websitePages.length > 0, 'dist/website has no index.html files');

for (const file of websitePages) {
  const html = await fs.readFile(file, 'utf8');
  const rel = path.relative(root, file);
  const exact = html.split(BANNER).length - 1;
  assert.equal(exact, 1, `${rel}: smart app banner meta must appear exactly once`);
  assert.equal((html.match(/apple-itunes-app/g) || []).length, 1, `${rel}: apple-itunes-app must appear exactly once`);
  assert.equal((html.match(/app-argument/g) || []).length, 0, `${rel}: no app-argument (Universal Links do not cover /website)`);
}

const allPages = await indexFiles(root);
for (const file of allPages) {
  const rel = path.relative(root, file);
  const onWebsite = rel === path.join('website', 'index.html') || rel.startsWith(`website${path.sep}`);
  if (onWebsite) continue;
  const html = await fs.readFile(file, 'utf8');
  assert.equal((html.match(/apple-itunes-app/g) || []).length, 0, `${rel}: app HTML must not include the smart app banner`);
}

const appHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
assert.equal((appHtml.match(/apple-itunes-app/g) || []).length, 0, 'dist/index.html must not include the smart app banner');

console.info(`Smart App Banner: ${websitePages.length} marketing pages include the meta once; app shell does not.`);
