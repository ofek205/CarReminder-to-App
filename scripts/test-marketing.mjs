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
  // A page may be rendered by its own component rather than the shared
  // sections list (the child-reminder page is), so there is nothing to assert
  // about section text for it. Guard rather than crash: this check exists to
  // prove sections are crawlable, not to require that every page have them.
  if (!Array.isArray(page.sections)) continue;
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

/*
 * Every prerendered route needs a Vercel rewrite, or the crawler never sees it.
 *
 * vercel.json ends with a catch-all that sends anything unmatched to
 * /index.html, the APP shell. A marketing route missing its rewrite therefore
 * still WORKS for a human — the SPA boots and React Router draws the page — so
 * nothing looks broken. Googlebot gets the app shell instead: no prerendered
 * copy, no canonical, no description. The page is invisible to search while
 * appearing fine to everyone who checks it in a browser.
 *
 * That is exactly what happened to /website/accessibility and
 * /website/child-in-car-reminder, and it is a silent failure, so it needs a
 * gate rather than a habit.
 */
const vercel = JSON.parse(await fs.readFile('vercel.json', 'utf8'));
const rewritten = new Set(vercel.rewrites.map(rule => rule.source.replace(/\/$/, '')));
for (const route of marketingRoutes) {
  assert.ok(rewritten.has(route), `${route}: no vercel.json rewrite, so the crawler would get the app shell instead of the prerendered page`);
}
const catchAll = vercel.rewrites[vercel.rewrites.length - 1];
assert.ok(catchAll.source.startsWith('/((?!'), 'the catch-all rewrite must stay last, or the routes above never match');

console.log(`Marketing checks passed: ${pages.size} pages, crawlable copy, headings, links, assets, report privacy, punctuation, ${multiLineHeadings} spaced line breaks, title/description budgets.`);

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
}

const homeHtml = pages.get('/website');
const homeSchema = jsonLd(homeHtml).find(block => block['@type'] === 'MobileApplication');
assert.ok(homeSchema, '/website: MobileApplication JSON-LD is in the initial HTML');
assert.ok(!JSON.stringify(homeSchema).includes('aggregateRating'), '/website: no aggregate rating on the app');
assert.equal(homeSchema.offers, undefined);
assert.equal(homeSchema.price, undefined);
assert.deepEqual(homeSchema.installUrl, [
  'https://apps.apple.com/app/carreminder/id6764073107',
  'https://play.google.com/store/apps/details?id=com.carreminder.app',
]);

for (const guide of guides) {
  const route = `/website/guides/${guide.slug}`;
  const html = pages.get(route);
  const blocks = jsonLd(html);
  const graph = blocks.find(block => Array.isArray(block['@graph']));
  assert.ok(graph, `${route}: Article graph is in the initial HTML`);
  assert.deepEqual(graph['@graph'].map(node => node['@type']), ['BreadcrumbList', 'Article']);
  assert.equal(graph['@graph'][1].headline, guide.heading || guide.title);
}

assert.ok(pages.get('/website/guides/plate-check').includes('href="/website/vehicle-check"'), 'plate-check keeps its vehicle-check link');
assert.ok(pages.get('/website/inactive-vehicles').includes('href="/website/vehicle-check"'), 'inactive-vehicles keeps its vehicle-check link');
for (const route of ['/website/guides/plate-check', '/website/inactive-vehicles', '/website/test-insurance-reminders']) {
  assert.ok(pages.get(route).includes('href="/website/vehicle-lookup"'), `${route}: links to vehicle lookup`);
}
for (const route of ['/website/test-insurance-reminders', '/website/guides/test-reminder', '/website/vehicle-lookup']) {
  assert.ok(pages.get(route).includes('href="/website/child-in-car-reminder"'), `${route}: links to the child reminder`);
}
for (const route of ['/website/documents', '/website/guides/maintenance-log', '/website/guides/test-reminder']) {
  assert.ok(pages.get(route).includes('href="/website/guides/vehicle-documents"'), `${route}: links to the documents guide`);
}

assert.equal((homeHtml.match(/\/marketing\/cards\/[^"]+\.webp/g) || []).length, 8, 'homepage category cards use the resized files');
assert.ok(homeHtml.includes('type="image/avif"'), 'category cards offer AVIF');
assert.ok(homeHtml.includes('width="840"'), 'category cards keep width');
assert.ok(homeHtml.includes('height="473"'), 'category cards keep height');
const lcp = homeHtml.match(/<img[^>]*hero-land-cruiser\.webp[^>]*>/);
assert.ok(lcp, 'the first hero image is in the initial HTML');
assert.ok(!lcp[0].includes('loading="lazy"'), 'the LCP hero image is not lazy');
assert.ok(lcp[0].includes('loading="eager"'), 'the LCP hero image loads eagerly');
assert.ok(!homeHtml.includes('/marketing/hero-harley.webp'), 'later hero slides are not in the first HTML');
for (const match of homeHtml.matchAll(/srcset="(\/marketing\/cards\/[^"]+\.avif)"/g)) {
  await fs.access(path.join('dist', match[1]));
}
