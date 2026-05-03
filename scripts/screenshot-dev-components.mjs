// Quick screenshot of /dev/components to verify sprint 1 deliverable.
// Run from repo root: `node scripts/screenshot-dev-components.mjs`
// Requires: vite dev server running on port 5193.
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, '..', 'sprint1-dev-components.png');

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
await page.goto('http://localhost:5193/dev/components', {
  waitUntil: 'networkidle0',
  timeout: 30_000,
});
// Wait an extra beat for fonts + lazy chunks
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: out, fullPage: true });
console.log('Saved screenshot to', out);
await browser.close();
