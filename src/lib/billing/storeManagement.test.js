/**
 * Every store against every platform. Three of the six combinations are
 * wrong in ways a browser preview never shows, which is why the whole
 * decision is a pure function and this table exists.
 */

import { describe, it, expect } from 'vitest';
import { managementCopy, storeOfSource, nativeStoreOf, STORE } from './storeManagement';

const PLATFORMS = ['android', 'ios', 'web'];

describe('storeOfSource', () => {
  it('maps the two store sources and nothing else', () => {
    expect(storeOfSource('iap_google')).toBe(STORE.GOOGLE);
    expect(storeOfSource('iap_apple')).toBe(STORE.APPLE);
    for (const s of ['default', 'grandfather', 'admin_grant', null, undefined, '']) {
      expect(storeOfSource(s), String(s)).toBeNull();
    }
  });

  it('knows which store each phone has', () => {
    expect(nativeStoreOf('android')).toBe(STORE.GOOGLE);
    expect(nativeStoreOf('ios')).toBe(STORE.APPLE);
    expect(nativeStoreOf('web')).toBeNull();
  });
});

describe('managementCopy', () => {
  it('renders nothing for a plan no store holds', () => {
    for (const p of PLATFORMS) {
      expect(managementCopy('admin_grant', p), p).toBeNull();
      expect(managementCopy('default', p), p).toBeNull();
      expect(managementCopy(undefined, p), p).toBeNull();
    }
  });

  it('opens the store page only on the phone whose store holds the subscription', () => {
    expect(managementCopy('iap_google', 'android').canOpenHere).toBe(true);
    expect(managementCopy('iap_apple', 'ios').canOpenHere).toBe(true);
    // Apple's page would show a list the Google plan is not in, and back.
    expect(managementCopy('iap_google', 'ios').canOpenHere).toBe(false);
    expect(managementCopy('iap_apple', 'android').canOpenHere).toBe(false);
    expect(managementCopy('iap_google', 'web').canOpenHere).toBe(false);
    expect(managementCopy('iap_apple', 'web').canOpenHere).toBe(false);
  });

  it('keeps the Android wording, minus the plan switch Play cannot do', () => {
    expect(managementCopy('iap_google', 'android')).toMatchObject({
      title: 'ניהול המנוי ב-Google Play',
      detail: 'שם אפשר לבטל או לשנות אמצעי תשלום. ביטול נשאר בתוקף עד סוף התקופה ששולמה.',
    });
    expect(managementCopy('iap_google', 'web')).toMatchObject({
      title: 'המנוי מנוהל דרך Google Play',
      detail: 'ביטול ושינוי אמצעי תשלום נעשים באפליקציה במכשיר האנדרואיד שבו נרכש המנוי.',
    });
  });

  it('never names Google or Android inside the iPhone app (Guideline 2.3.10)', () => {
    for (const source of ['iap_google', 'iap_apple']) {
      const c = managementCopy(source, 'ios');
      const text = `${c.title} ${c.detail}`;
      expect(text, source).not.toMatch(/google|play|android|אנדרואיד|גוגל/i);
    }
  });

  it('does not promise a payment-method control on Apple\'s subscriptions page', () => {
    expect(managementCopy('iap_apple', 'ios').detail).not.toMatch(/אמצעי תשלום/);
  });

  it('never promises a plan switch where Play is the store', () => {
    // Play's subscription centre cannot switch products.
    expect(managementCopy('iap_google', 'android').detail).not.toMatch(/מסלול אחר|שינוי המסלול/);
    expect(managementCopy('iap_google', 'ios').detail).not.toMatch(/מסלול אחר|שינוי המסלול/);
  });

  it('uses one neutral pair for the other phone, in both directions', () => {
    expect(managementCopy('iap_google', 'ios').title).toBe(managementCopy('iap_apple', 'android').title);
    expect(managementCopy('iap_google', 'ios').detail).toBe(managementCopy('iap_apple', 'android').detail);
  });

  it('names the store in a browser, where no store rule applies', () => {
    expect(managementCopy('iap_apple', 'web').title).toMatch(/App Store/);
  });

  it('gives an unrecognised native platform the neutral pair, never a store name', () => {
    for (const source of ['iap_google', 'iap_apple']) {
      const c = managementCopy(source, 'other');
      expect(c.canOpenHere).toBe(false);
      expect(`${c.title} ${c.detail}`).not.toMatch(/google|play|app store|android|אנדרואיד|אייפון/i);
    }
  });

  it('has no dash separators in any Hebrew string', () => {
    for (const source of ['iap_google', 'iap_apple']) {
      for (const p of PLATFORMS) {
        const c = managementCopy(source, p);
        // The ב- joiner before a Latin store name is the one allowed hyphen.
        const text = `${c.title} ${c.detail}`.replace(/ב-(?=[A-Za-z])/g, '');
        expect(text, `${source}/${p}`).not.toMatch(/[—–-]/);
      }
    }
  });
});
