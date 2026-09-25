import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { GA4_MEASUREMENT_ID, SITE_GTAG_SNIPPET } from './siteGtagSnippet.js';

const APPLE = 'https://apps.apple.com/app/carreminder/id6764073107';
const PLAY = 'https://play.google.com/store/apps/details?id=com.carreminder.app';
const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;

function boot(options = {}) {
  const scripts = [];
  if (options.existingSrc) scripts.push({ src: options.existingSrc, async: true });
  const listeners = [];
  const location = {
    hostname: options.hostname,
    protocol: options.protocol || 'https:',
    pathname: options.pathname || '/',
    search: options.search || '',
    hash: options.hash || '',
    origin: (options.protocol || 'https:') + '//' + options.hostname,
  };
  const context = {
    listeners,
    scripts,
    location,
    document: {
      addEventListener(type, fn, capture) {
        listeners.push({ type, fn, capture });
      },
      querySelector(selector) {
        if (selector.indexOf('googletagmanager.com/gtag/js') === -1) return null;
        return scripts.find(script => String(script.src || '').indexOf('googletagmanager.com/gtag/js') !== -1) || null;
      },
      createElement() {
        return { async: false, src: '' };
      },
      head: {
        appendChild(node) { scripts.push(node); },
      },
    },
  };
  context.window = context;
  if (options.native) context.Capacitor = { isNativePlatform: () => true };
  if (options.inFrame) {
    context.self = {};
    context.top = {};
  } else {
    context.self = context;
    context.top = context;
  }
  vm.runInNewContext(SITE_GTAG_SNIPPET, context);
  return context;
}

function gtagCalls(context) {
  if (!context.dataLayer) return [];
  return context.dataLayer.map(args => Array.from(args));
}

function link({ href, linkLocation, sectionId }) {
  const marked = linkLocation
    ? { getAttribute: name => (name === 'data-link-location' ? linkLocation : null) }
    : null;
  const section = sectionId ? { id: sectionId } : null;
  return {
    getAttribute: name => (name === 'href' ? href : null),
    closest(selector) {
      if (selector === 'a') return this;
      if (selector === '[data-link-location]') return marked;
      if (selector === 'section[id]') return section;
      return null;
    },
  };
}

function click(context, anchor) {
  let prevented = false;
  context.listeners[0].fn({
    target: anchor,
    preventDefault() { prevented = true; },
  });
  return prevented;
}

describe('site gtag snippet', () => {
  it('does not embed the full gtag URL as one string', () => {
    expect(SITE_GTAG_SNIPPET.includes('gtag/js?id=' + GA4_MEASUREMENT_ID)).toBe(false);
    expect(SITE_GTAG_SNIPPET.includes(GA4_MEASUREMENT_ID)).toBe(true);
  });

  it('loads once on the production host and strips query and hash from page_location', () => {
    const context = boot({
      hostname: 'car-reminder.app',
      pathname: '/Auth',
      search: '?code=secret',
      hash: '#access_token=secret',
    });
    expect(context.scripts.map(script => script.src)).toEqual([GTAG_SRC]);
    const config = gtagCalls(context).find(call => call[0] === 'config');
    expect(config[1]).toBe(GA4_MEASUREMENT_ID);
    expect(config[2]).toEqual({ page_location: 'https://car-reminder.app/Auth' });
    expect(context.listeners).toHaveLength(1);
    expect(context.listeners[0].capture).toBe(true);
  });

  it('also allows www.car-reminder.app', () => {
    const context = boot({ hostname: 'www.car-reminder.app', pathname: '/' });
    expect(context.scripts).toHaveLength(1);
  });

  it('does not load on preview, localhost, or an empty host', () => {
    for (const hostname of ['localhost', '127.0.0.1', 'car-reminder-git-staging.vercel.app', '']) {
      const context = boot({ hostname, pathname: '/' });
      expect(context.scripts, hostname).toHaveLength(0);
      expect(context.dataLayer).toBeUndefined();
    }
  });

  it('does not load inside an iframe, even on the production host', () => {
    const context = boot({ hostname: 'car-reminder.app', inFrame: true });
    expect(context.scripts).toHaveLength(0);
    expect(context.listeners).toHaveLength(1);
  });

  it('does not load when Capacitor reports a native platform', () => {
    const context = boot({ hostname: 'car-reminder.app', native: true });
    expect(context.scripts).toHaveLength(0);
  });

  it('does not insert a second gtag script or a second config when one is already in the document', () => {
    const context = boot({ hostname: 'car-reminder.app', pathname: '/website', existingSrc: GTAG_SRC });
    expect(context.scripts).toHaveLength(1);
    expect(context.scripts[0].src).toBe(GTAG_SRC);
    expect(context.dataLayer).toBeUndefined();
  });

  it('installs the click listener only once', () => {
    const context = boot({ hostname: 'localhost' });
    vm.runInNewContext(SITE_GTAG_SNIPPET, context);
    expect(context.listeners).toHaveLength(1);
  });

  it('sends one store event per click and does not cancel navigation', () => {
    const context = boot({ hostname: 'car-reminder.app', pathname: '/website/guides/test-reminder' });
    const before = gtagCalls(context).length;
    const prevented = click(context, link({ href: APPLE, linkLocation: 'guide_cta', sectionId: 'download' }));
    expect(prevented).toBe(false);
    const events = gtagCalls(context).slice(before).filter(call => call[0] === 'event');
    expect(events).toEqual([[
      'event',
      'app_store_click',
      {
        link_location: 'guide_cta',
        page_path: '/website/guides/test-reminder',
        transport_type: 'beacon',
      },
    ]]);

    click(context, link({ href: PLAY, sectionId: 'download' }));
    const play = gtagCalls(context).filter(call => call[1] === 'play_store_click');
    expect(play).toHaveLength(1);
    expect(play[0][2].link_location).toBe('download');

    click(context, link({ href: PLAY }));
    const other = gtagCalls(context).filter(call => call[1] === 'play_store_click');
    expect(other[1][2].link_location).toBe('other');

    const count = gtagCalls(context).filter(call => call[0] === 'event').length;
    click(context, link({ href: 'https://car-reminder.app/PrivacyPolicy' }));
    expect(gtagCalls(context).filter(call => call[0] === 'event')).toHaveLength(count);
  });

  it('does nothing when gtag is not available', () => {
    const context = boot({ hostname: 'localhost', pathname: '/website' });
    expect(() => click(context, link({ href: APPLE, linkLocation: 'download' }))).not.toThrow();
    expect(context.dataLayer).toBeUndefined();
  });
});
