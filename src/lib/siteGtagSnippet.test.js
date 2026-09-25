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
  location.href = location.origin + location.pathname + location.search + location.hash;
  const history = {
    pushState() {},
    replaceState() {},
  };
  const context = {
    listeners,
    scripts,
    location,
    history,
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture });
    },
    document: {
      addEventListener(type, fn, capture) {
        listeners.push({ type, fn, capture });
      },
      querySelector(selector) {
        if (selector.indexOf('googletagmanager.com/gtag/js') === -1) return null;
        return scripts.find(script => String(script.src || '').indexOf('googletagmanager.com/gtag/js') !== -1) || null;
      },
      createElement() {
        return {
          async: false,
          src: '',
          addEventListener(type, fn) {
            listeners.push({ type, fn, capture: false });
          },
        };
      },
      head: {
        appendChild(node) { scripts.push(node); },
      },
    },
  };
  context.window = context;
  context.URL = URL;
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

  it('loads once on `/` and strips query and hash from the single page view', () => {
    const context = boot({
      hostname: 'car-reminder.app',
      pathname: '/',
      search: '?code=secret',
      hash: '#access_token=secret',
    });
    expect(context.scripts.map(script => script.src)).toEqual([GTAG_SRC]);
    const config = gtagCalls(context).find(call => call[0] === 'config');
    expect(config[1]).toBe(GA4_MEASUREMENT_ID);
    expect(config[2]).toEqual({
      send_page_view: false,
      page_location: 'https://car-reminder.app/',
    });
    const views = gtagCalls(context).filter(call => call[1] === 'page_view');
    expect(views).toEqual([[
      'event',
      'page_view',
      { page_location: 'https://car-reminder.app/', page_path: '/' },
    ]]);
    expect(context.listeners[0].type).toBe('click');
    expect(context.listeners[0].capture).toBe(true);
  });

  it('does not load on app routes', () => {
    for (const pathname of ['/Auth', '/Dashboard', '/VehicleDetail', '/JoinInvite', '/VehicleTransfer']) {
      const context = boot({
        hostname: 'car-reminder.app',
        pathname,
        search: '?token=secret',
        hash: '#access_token=secret',
      });
      expect(context.scripts, pathname).toHaveLength(0);
      expect(context.dataLayer, pathname).toBeUndefined();
      expect(context['ga-disable-' + GA4_MEASUREMENT_ID], pathname).toBeUndefined();
    }
  });

  it('stops collection when history leaves the measured path', () => {
    const context = boot({ hostname: 'car-reminder.app', pathname: '/' });
    const disableKey = 'ga-disable-' + GA4_MEASUREMENT_ID;
    expect(context[disableKey]).toBeUndefined();
    context.history.pushState({}, '', '/Dashboard?id=1');
    expect(context[disableKey]).toBe(true);
    expect(gtagCalls(context).filter(call => call[1] === 'page_view')).toHaveLength(1);

    const replaced = boot({ hostname: 'car-reminder.app', pathname: '/website' });
    replaced.history.replaceState({}, '', '/Auth?code=secret');
    expect(replaced[disableKey]).toBe(true);

    const popped = boot({ hostname: 'car-reminder.app', pathname: '/' });
    popped.location.pathname = '/JoinInvite';
    const pop = popped.listeners.find(listener => listener.type === 'popstate');
    pop.fn();
    expect(popped[disableKey]).toBe(true);

    const rewrapped = boot({ hostname: 'car-reminder.app', pathname: '/' });
    rewrapped.history.pushState = function () {};
    const onLoad = rewrapped.listeners.find(listener => listener.type === 'load');
    onLoad.fn();
    rewrapped.history.pushState({}, '', '/VehicleTransfer?token=secret');
    expect(rewrapped[disableKey]).toBe(true);
    expect(gtagCalls(rewrapped).filter(call => call[1] === 'page_view')).toHaveLength(1);
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
    context.history.pushState({}, '', '/Auth?code=secret');
    expect(context['ga-disable-' + GA4_MEASUREMENT_ID]).toBe(true);
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
