import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { marketingRoutes, guides, productPages, marketingMetadata } from '../src/lib/marketingContent.js';

assert.equal(new Set(marketingRoutes).size, marketingRoutes.length, 'Routes must be unique');
const pages = new Map();
for (const route of marketingRoutes) {
  const html = await fs.readFile(path.join('dist', route, 'index.html'), 'utf8');
  pages.set(route, html);
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `${route}: one primary heading`);
  assert.ok(html.includes(marketingMetadata(route).title), `${route}: route-specific title is in the initial HTML`);
  assert.ok(!html.includes('id="cr-boot-fallback"'), `${route}: no boot screen in crawlable content`);
  assert.ok(!html.includes('src="./'), `${route}: assets must resolve from deep links`);
  assert.ok(!html.includes('/src/assets/'), `${route}: no development-only assets`);
  for (const match of html.matchAll(/(?:src|href)="(\/(?:assets|marketing)\/[^"?#]+)"/g)) {
    await fs.access(path.join('dist', match[1]));
  }
}
for (const page of [...guides, ...productPages]) {
  const route = `/website/${guides.includes(page) ? 'guides/' : ''}${page.slug}`;
  for (const [heading, paragraph] of page.sections) {
    assert.ok(pages.get(route).includes(heading), `${route}: section heading is available without JavaScript`);
    assert.ok(pages.get(route).includes(paragraph), `${route}: full article is available without JavaScript`);
  }
}
for (const [route, html] of pages) {
  for (const match of html.matchAll(/href="(\/website[^"?]*)"/g)) {
    const [target, anchor] = match[1].split('#');
    assert.ok(pages.has(target), `${route}: unknown website link ${target}`);
    if (anchor) assert.ok(pages.get(target).includes(`id="${anchor}"`), `${route}: missing anchor ${anchor}`);
  }
}
assert.ok(pages.get('/website/vehicle-check').includes('noindex,follow'), 'Vehicle reports must not be indexed');
for (const file of ['src/pages/Marketing.jsx', 'src/lib/marketingContent.js', 'src/lib/marketingSpecialties.js']) {
  assert.ok(!/[\u2013\u2014]/.test(await fs.readFile(file, 'utf8')), `${file}: no long dashes`);
}
console.log(`Marketing checks passed: ${pages.size} pages, crawlable copy, headings, links, assets, report privacy, punctuation.`);
