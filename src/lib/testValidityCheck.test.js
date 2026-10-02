import { afterEach, describe, expect, it } from 'vitest';
import { guides, testReminderFaq } from './marketingContent';
import { faqJsonLd, guideJsonLd } from './marketingSchema';
import {
  daysUntil,
  formatHebrewDate,
  lookupTestValidity,
  normalizePlateDigits,
  presentTestValidity,
  trackTestCheckSubmit,
  validityPhrase,
} from './testValidityCheck';

const TODAY = new Date(2026, 9, 2);
const PLATE = '7998232';

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

afterEach(() => {
  delete globalThis.window;
});

describe('normalizePlateDigits', () => {
  it('accepts 7 or 8 digits and ignores dashes and spaces', () => {
    expect(normalizePlateDigits('12-345-67')).toEqual({ ok: true, plate: '1234567' });
    expect(normalizePlateDigits('123 45678')).toEqual({ ok: true, plate: '12345678' });
  });

  it('rejects other lengths, letters, and a leading zero', () => {
    expect(normalizePlateDigits('123456').ok).toBe(false);
    expect(normalizePlateDigits('123456789').ok).toBe(false);
    expect(normalizePlateDigits('12ab567').ok).toBe(false);
    expect(normalizePlateDigits('01234567').ok).toBe(false);
    expect(normalizePlateDigits('').message).toBe('מספר רישוי צריך 7 או 8 ספרות.');
  });
});

describe('validity dates', () => {
  it('counts whole local days and phrases an expired test', () => {
    expect(daysUntil('2026-10-02', TODAY)).toBe(0);
    expect(daysUntil('2026-10-03', TODAY)).toBe(1);
    expect(daysUntil('2026-10-01', TODAY)).toBe(-1);
    expect(daysUntil('2026-09-20', TODAY)).toBe(-12);
    expect(validityPhrase(0)).toBe('התוקף עד היום');
    expect(validityPhrase(1)).toBe('נותר יום אחד');
    expect(validityPhrase(-1)).toBe('פג תוקף לפני יום');
    expect(validityPhrase(-12)).toBe('פג תוקף לפני 12 ימים');
    expect(formatHebrewDate('2027-11-02')).toBe('02.11.2027');
  });

  it('shows make, model, and year only when the registry sent them', () => {
    const view = presentTestValidity({
      testDueDate: '2027-11-02',
      lastTestDate: '2026-09-29',
      manufacturer: 'רובר אנגליה',
      model: 'DISCOVERY SPORT',
      year: '2015',
    }, TODAY);
    expect(view.identityLine).toBe('רובר אנגליה DISCOVERY SPORT, 2015');
    expect(view.dueLabel).toBe('02.11.2027');
    expect(view.lastTestLabel).toBe('29.09.2026');
    expect(view.expired).toBe(false);
    expect(view.expiringSoon).toBe(false);
    expect(view.duePhrase).toContain('נותרו');
  });

  it('marks a test that expires within 30 days, including today', () => {
    const soon = presentTestValidity({ testDueDate: '2026-11-01' }, TODAY);
    const edge = presentTestValidity({ testDueDate: '2026-10-02' }, TODAY);
    const later = presentTestValidity({ testDueDate: '2026-11-02' }, TODAY);
    const expired = presentTestValidity({ testDueDate: '2026-10-01' }, TODAY);
    expect(soon.expiringSoon).toBe(true);
    expect(soon.expired).toBe(false);
    expect(soon.duePhrase).toBe('נותרו 30 ימים');
    expect(edge.expiringSoon).toBe(true);
    expect(edge.duePhrase).toBe('התוקף עד היום');
    expect(later.expiringSoon).toBe(false);
    expect(expired.expiringSoon).toBe(false);
    expect(expired.expired).toBe(true);
  });
});

describe('lookupTestValidity', () => {
  it('asks the private-car resource for dates and identity only', async () => {
    let requested = '';
    const fetchImpl = async (url) => {
      requested = url;
      return jsonResponse({
        success: true,
        result: {
          records: [{
            tokef_dt: '2027-11-02',
            mivchan_acharon_dt: '2026-09-29',
            tozeret_nm: 'רובר אנגליה',
            kinuy_mishari: 'DISCOVERY SPORT',
            shnat_yitzur: 2015,
            misgeret: 'SHOULD-NOT-PASS',
            mispar_rechev: Number(PLATE),
          }],
        },
      });
    };
    const outcome = await lookupTestValidity(PLATE, { fetchImpl, today: TODAY });
    expect(requested).toContain('resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3');
    expect(requested).toContain('filters=');
    expect(requested).toContain('tokef_dt');
    expect(requested).toContain('mivchan_acharon_dt');
    expect(requested).not.toContain('misgeret');
    expect(outcome.status).toBe('found');
    expect(outcome.record).toEqual({
      testDueDate: '2027-11-02',
      lastTestDate: '2026-09-29',
      manufacturer: 'רובר אנגליה',
      model: 'DISCOVERY SPORT',
      year: '2015',
    });
    expect(JSON.stringify(outcome)).not.toContain(PLATE);
  });

  it('returns not_found, error, and network without throwing', async () => {
    const empty = await lookupTestValidity(PLATE, {
      fetchImpl: async () => jsonResponse({ success: true, result: { records: [] } }),
    });
    expect(empty).toEqual({ status: 'not_found' });

    const bad = await lookupTestValidity(PLATE, {
      fetchImpl: async () => jsonResponse({}, false),
    });
    expect(bad).toEqual({ status: 'error' });

    const down = await lookupTestValidity(PLATE, {
      fetchImpl: async () => { throw new Error('offline'); },
    });
    expect(down).toEqual({ status: 'network' });
  });

  it('stops when the caller aborts, and reports offline separately', async () => {
    const already = new AbortController();
    already.abort();
    let called = false;
    const skipped = await lookupTestValidity(PLATE, {
      fetchImpl: async () => { called = true; return jsonResponse({}); },
      signal: already.signal,
    });
    expect(skipped).toEqual({ status: 'aborted' });
    expect(called).toBe(false);

    const pending = new AbortController();
    const cancelled = lookupTestValidity(PLATE, {
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
      signal: pending.signal,
    });
    pending.abort();
    expect(await cancelled).toEqual({ status: 'aborted' });

    const previousNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    try {
      let fetched = false;
      const offline = await lookupTestValidity(PLATE, {
        fetchImpl: async () => { fetched = true; throw new Error('failed'); },
      });
      expect(offline).toEqual({ status: 'offline' });
      expect(fetched).toBe(false);
    } finally {
      if (previousNav) Object.defineProperty(globalThis, 'navigator', previousNav);
      else delete globalThis.navigator;
    }
  });

  it('uses the dev proxy only on a local host', async () => {
    const previous = globalThis.window;
    globalThis.window = { location: { hostname: 'localhost', pathname: '/website/guides/test-reminder' } };
    try {
      let requested = '';
      await lookupTestValidity(PLATE, {
        fetchImpl: async (url) => {
          requested = url;
          return jsonResponse({ success: true, result: { records: [] } });
        },
      });
      expect(requested.startsWith('/gov-api/api/3/action/datastore_search')).toBe(true);
      expect(requested).toContain('resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3');
    } finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });
});

describe('trackTestCheckSubmit', () => {
  it('sends a status and never a plate', () => {
    const calls = [];
    globalThis.window = {
      gtag: (...args) => calls.push(args),
      location: { pathname: '/website/guides/test-reminder' },
    };
    trackTestCheckSubmit('found', { plate: PLATE });
    expect(calls).toEqual([[
      'event',
      'test_check_submit',
      { result_status: 'found', page_path: '/website/guides/test-reminder' },
    ]]);
    expect(JSON.stringify(calls)).not.toContain(PLATE);
  });

  it('does nothing without gtag or off this page', () => {
    globalThis.window = { location: { pathname: '/website/guides/test-reminder' } };
    expect(() => trackTestCheckSubmit('found')).not.toThrow();
    globalThis.window = {
      gtag: () => { throw new Error('should not be called'); },
      location: { pathname: '/website' },
    };
    expect(() => trackTestCheckSubmit('found')).not.toThrow();
  });
});

describe('test reminder FAQ', () => {
  it('is about 300 Hebrew words and has no long dashes', () => {
    const article = guides.find(item => item.slug === 'test-reminder');
    expect(article.faq).toBe(testReminderFaq);
    const text = testReminderFaq.map(item => item.join(' ')).join(' ');
    const words = text.match(/[\u0590-\u05FF]+/g) || [];
    expect(words.length).toBeGreaterThan(280);
    expect(words.length).toBeLessThan(380);
    expect(text).not.toMatch(/[\u2013\u2014]/);
    const schema = faqJsonLd(testReminderFaq);
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity.map(item => item.name)).toEqual(testReminderFaq.map(([name]) => name));
    expect(guideJsonLd(article)['@graph'].map(node => node['@type'])).toEqual(['BreadcrumbList', 'Article']);
  });
});
