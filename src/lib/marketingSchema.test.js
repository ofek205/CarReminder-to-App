import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { guides, productPages } from './marketingContent';
import {
  APPLE_STORE_URL, GOOGLE_PLAY_URL, faqJsonLd, guideJsonLd, guidePublishedDates,
  mobileAppJsonLd, organizationJsonLd, pageJsonLd,
} from './marketingSchema';

function keys(value, found = []) {
  if (Array.isArray(value)) value.forEach(item => keys(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      keys(child, found);
    }
  }
  return found;
}

describe('marketing JSON-LD', () => {
  it('describes the mobile app with store URLs that already appear in the site', () => {
    const data = mobileAppJsonLd();
    expect(data['@type']).toBe('MobileApplication');
    expect(data.name).toBe('Car Reminder');
    expect(data.operatingSystem).toBe('iOS, Android');
    expect(data.installUrl).toEqual([APPLE_STORE_URL, GOOGLE_PLAY_URL]);
    const marketing = fs.readFileSync(new URL('../pages/Marketing.jsx', import.meta.url), 'utf8');
    expect(marketing).toContain(APPLE_STORE_URL);
    expect(marketing).toContain(GOOGLE_PLAY_URL);
    const names = keys(data);
    expect(names).not.toContain('aggregateRating');
    expect(names).not.toContain('offers');
    expect(names).not.toContain('price');
    expect(names).not.toContain('applicationCategory');
  });

  it('adds an article and a breadcrumb list to every guide, without a rating', () => {
    expect(guides.length).toBeGreaterThan(0);
    for (const article of guides) {
      const data = guideJsonLd(article);
      const types = data['@graph'].map(node => node['@type']);
      expect(types).toEqual(['BreadcrumbList', 'Article']);
      const crumbs = data['@graph'][0].itemListElement;
      expect(crumbs.map(item => item.position)).toEqual([1, 2, 3]);
      expect(crumbs[0].item).toBe('https://car-reminder.app/website');
      expect(crumbs[1].item).toBe('https://car-reminder.app/website#guides');
      expect(crumbs[2].name).toBe(article.heading || article.title);
      const story = data['@graph'][1];
      expect(story.headline).toBe(article.heading || article.title);
      expect(story.description).toBe(article.description || article.text);
      expect(story.inLanguage).toBe('he');
      expect(story.mainEntityOfPage).toBe(`https://car-reminder.app/website/guides/${article.slug}`);
      expect(story.publisher).toMatchObject({ '@type': 'Organization', name: 'Car Reminder', logo: 'https://car-reminder.app/icons/icon-512x512.png' });
      expect(story.author).toEqual(story.publisher);
      expect(story.image).toBe('https://car-reminder.app/marketing/og-main.jpg');
      expect(keys(data)).not.toContain('aggregateRating');
    }
  });

  // Every URL that reaches a BreadcrumbList must be absolute. Google rejects a
  // relative `item`, and three pages shipped `item: '/website'`.
  it('never emits a relative breadcrumb URL, on any page', () => {
    const graphs = [
      ...guides.map(guideJsonLd),
      ...productPages.map(p => pageJsonLd(p.heading || p.title, p.faq)),
      pageJsonLd('ניהול צי רכב לעסקים', [['q', 'a']]),
    ];
    for (const data of graphs) {
      for (const node of data['@graph']) {
        if (node['@type'] !== 'BreadcrumbList') continue;
        for (const crumb of node.itemListElement) {
          if (crumb.item !== undefined) expect(crumb.item).toMatch(/^https:\/\/car-reminder\.app\//);
        }
        // the current page is the last crumb and carries no URL
        expect(node.itemListElement.at(-1).item).toBeUndefined();
      }
    }
  });

  it('dates only the guides it can prove, with real past dates', () => {
    const slugs = new Set(guides.map(g => g.slug));
    for (const [slug, date] of Object.entries(guidePublishedDates)) {
      expect(slugs.has(slug), `${slug} is not a guide, so its date is a typo`).toBe(true);
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(date).getTime()).toBeLessThanOrEqual(Date.now());
    }
    // A guide with no entry must emit no datePublished rather than a guess.
    expect(guideJsonLd({ slug: 'not-yet-dated', title: 't', text: 'x' })['@graph'][1].datePublished).toBeUndefined();
    // And no dateModified anywhere: nothing here can keep it true.
    for (const g of guides) expect(guideJsonLd(g)['@graph'][1].dateModified).toBeUndefined();
  });

  it('adds a FAQPage only when the page has questions', () => {
    const withFaq = pageJsonLd('x', [['q1', 'a1'], ['q2', 'a2']]);
    expect(withFaq['@graph'].map(n => n['@type'])).toEqual(['BreadcrumbList', 'FAQPage']);
    expect(withFaq['@graph'][1].mainEntity.map(q => q.name)).toEqual(['q1', 'q2']);
    expect(pageJsonLd('x', [])['@graph'].map(n => n['@type'])).toEqual(['BreadcrumbList']);
    expect(pageJsonLd('x', undefined)['@graph'].map(n => n['@type'])).toEqual(['BreadcrumbList']);
    expect(faqJsonLd([['q', 'a']]).mainEntity[0].acceptedAnswer.text).toBe('a');
  });

  it('describes the organisation with only what the repo can vouch for', () => {
    const org = organizationJsonLd();
    expect(org.logo).toMatch(/^https:\/\//);
    expect(org.url).toBe('https://car-reminder.app/website');
    expect(org.sameAs).toEqual([APPLE_STORE_URL, GOOGLE_PLAY_URL]);
    const names = keys(org);
    for (const banned of ['aggregateRating', 'offers', 'price', 'review']) expect(names).not.toContain(banned);
  });

  // The regression that hid three FAQPage blocks: structured data injected
  // from a useEffect never reaches the prerendered HTML, because
  // renderToString does not run effects.
  //
  // It is matched by its exact signature, a property ASSIGNMENT
  // (`schema.type = 'application/ld+json'`), which is how all three were
  // written. The two legitimate forms do not match and should not:
  //   · the JSX attribute in MarketingJsonLd.jsx (`type="…"`), which IS the fix
  //   · the object property in marketingSeo.js (`type: '…'`), which updates the
  //     already-prerendered WebPage block by id on SPA navigation
  it('injects no structured data from effects', () => {
    const root = new URL('../', import.meta.url);
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      return e.isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
    const offenders = walk(root)
      .filter(p => /\.type\s*=\s*['"]application\/ld\+json['"]/.test(fs.readFileSync(p, 'utf8')))
      .map(p => p.pathname.split('/src/')[1]);
    expect(offenders).toEqual([]);
  });
});
