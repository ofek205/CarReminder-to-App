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
/*
 * Headings must read as WORDS to a crawler.
 *
 * Every two-line heading on this site is written as `text<br /><em>more</em>`,
 * and <br> contributes no space to textContent. So "גם לכלי השיט<br />יש מקום"
 * reached Google and every screen reader as "השיטיש", a token that is not a
 * word. Nine headings were like this, including the homepage h1, and nothing
 * looked wrong on screen because the line break renders exactly as intended.
 * A {' '} before each <br /> fixes it invisibly, which is precisely why it
 * needs a gate: the next heading someone adds will be written the old way.
 */
const norm = (s) => s.replace(/\s+/g, ' ').trim();
let multiLineHeadings = 0;
for (const [route, html] of pages) {
  for (const match of html.matchAll(/<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const inner = match[2];
    if (!/<br\s*\/?>/.test(inner)) continue;
    multiLineHeadings++;
    const asRead = norm(inner.replace(/<[^>]+>/g, ''));
    const asIntended = norm(inner.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ''));
    assert.equal(asRead, asIntended, `${route}: heading runs words together across the line break: "${asRead}"`);
  }
}

/*
 * Search-result budgets. A title over 60 characters is truncated with an
 * ellipsis, and a description under ~110 leaves result space unused. Both are
 * invisible locally: the page looks fine, the cost is paid in a listing nobody
 * on the team ever looks at. Duplicates are worse than either, because two
 * pages competing on one title is how a site teaches Google to ignore one.
 */
const seenTitles = new Map();
const seenDescriptions = new Map();
for (const route of marketingRoutes) {
  const { title, description } = marketingMetadata(route);
  assert.ok(title.length <= 60, `${route}: title is ${title.length} chars, over the 60 that fit a result`);
  assert.ok(description.length >= 110 && description.length <= 160,
    `${route}: description is ${description.length} chars, outside 110-160`);
  assert.ok(!seenTitles.has(title), `${route}: duplicate title, also used by ${seenTitles.get(title)}`);
  assert.ok(!seenDescriptions.has(description), `${route}: duplicate description, also used by ${seenDescriptions.get(description)}`);
  seenTitles.set(title, route);
  seenDescriptions.set(description, route);
}

console.log(`Marketing checks passed: ${pages.size} pages, crawlable copy, headings, links, assets, report privacy, punctuation, ${multiLineHeadings} spaced line breaks, title/description budgets.`);
