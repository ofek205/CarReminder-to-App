import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { guides } from './marketingContent';
import {
  APPLE_STORE_URL, GOOGLE_PLAY_URL, guideJsonLd, mobileAppJsonLd,
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
      expect(story.publisher).toEqual({ '@type': 'Organization', name: 'Car Reminder' });
      expect(keys(data)).not.toContain('aggregateRating');
    }
  });
});
