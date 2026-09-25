import { describe, it, expect } from 'vitest';
import { APPLE_STORE_URL, GOOGLE_PLAY_URL } from './marketingSchema';
import { appStoreUrl, googlePlayUrl } from './storeLinks';

const APPLE_NEEDLE = 'apps.apple.com/app/carreminder/id6764073107';
const PLAY_NEEDLE = 'play.google.com/store/apps/details?id=com.carreminder.app';
const LOCATIONS = ['hero', 'download', 'guide_cta', 'page_cta'];

function playUrl(loc) {
  const referrer = `utm_source=car-reminder.app&utm_medium=website&utm_campaign=${loc}`;
  return `${GOOGLE_PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}

describe('store campaign links', () => {
  it('builds the exact App Store and Google Play URLs for each website location', () => {
    for (const loc of LOCATIONS) {
      expect(appStoreUrl(loc)).toBe(`${APPLE_STORE_URL}?ct=website_${loc}`);
      expect(googlePlayUrl(loc)).toBe(playUrl(loc));
    }
  });

  it('keeps the canonical base URL and the substrings the store-click listener matches', () => {
    for (const loc of LOCATIONS) {
      const apple = appStoreUrl(loc);
      const play = googlePlayUrl(loc);
      expect(apple.startsWith(APPLE_STORE_URL)).toBe(true);
      expect(play.startsWith(GOOGLE_PLAY_URL)).toBe(true);
      expect(apple).toContain(APPLE_NEEDLE);
      expect(play).toContain(PLAY_NEEDLE);
    }
  });

  it('sanitizes odd locations to lowercase [a-z0-9_] and falls back to other', () => {
    expect(appStoreUrl('Hero')).toBe(`${APPLE_STORE_URL}?ct=website_hero`);
    expect(appStoreUrl('Guide CTA!')).toBe(`${APPLE_STORE_URL}?ct=website_guidecta`);
    expect(googlePlayUrl('Page-CTA')).toBe(playUrl('pagecta'));
    expect(appStoreUrl('')).toBe(`${APPLE_STORE_URL}?ct=website_other`);
    expect(appStoreUrl('   ')).toBe(`${APPLE_STORE_URL}?ct=website_other`);
    expect(appStoreUrl('***')).toBe(`${APPLE_STORE_URL}?ct=website_other`);
    expect(appStoreUrl(null)).toBe(`${APPLE_STORE_URL}?ct=website_other`);
    expect(appStoreUrl(undefined)).toBe(`${APPLE_STORE_URL}?ct=website_other`);
    expect(googlePlayUrl(null)).toBe(playUrl('other'));
  });

  it('truncates the App Store ct value to 40 characters', () => {
    const loc = 'a'.repeat(80);
    const ct = new URL(appStoreUrl(loc)).searchParams.get('ct');
    expect(ct).toHaveLength(40);
    expect(ct).toBe(`website_${'a'.repeat(32)}`);
    expect(new URL(googlePlayUrl(loc)).searchParams.get('referrer')).toBe(
      `utm_source=car-reminder.app&utm_medium=website&utm_campaign=${loc}`,
    );
  });

  it('never adds an Apple provider token', () => {
    for (const loc of [...LOCATIONS, 'pt=123', 'hero&pt=999', 'pt']) {
      expect(appStoreUrl(loc)).not.toMatch(/[?&]pt=/);
      expect(googlePlayUrl(loc)).not.toMatch(/[?&]pt=/);
    }
  });
});
