/**
 * vehicleCheckAnalytics: the public plate check may tell GA4 that a lookup
 * finished, and nothing else. Vitest runs in node, so window is stubbed
 * on globalThis rather than through jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { trackVehicleCheckSubmit } from './vehicleCheckAnalytics';

const PLATE = '12345678';

function installWindow({ pathname = '/website/vehicle-check', gtag, search = '' } = {}) {
  globalThis.window = {
    gtag,
    location: {
      pathname,
      search,
      href: 'https://carreminder.example' + pathname + search,
    },
  };
}

afterEach(() => {
  delete globalThis.window;
});

describe('trackVehicleCheckSubmit', () => {
  it('does nothing when gtag is missing', () => {
    installWindow({ gtag: undefined });
    expect(() => trackVehicleCheckSubmit({
      formLocation: 'vehicle_check_page',
      resultStatus: 'found',
      plate: PLATE,
    })).not.toThrow();

    delete globalThis.window;
    expect(() => trackVehicleCheckSubmit({
      formLocation: 'home_form',
      resultStatus: 'found',
    })).not.toThrow();
  });

  it('does nothing when gtag is not a function', () => {
    installWindow({ gtag: { event: true } });
    expect(() => trackVehicleCheckSubmit({
      formLocation: 'vehicle_check_page',
      resultStatus: 'error',
    })).not.toThrow();
  });

  it('does nothing on in-app routes', () => {
    const gtag = viGtag();
    for (const pathname of ['/vehicle-check', '/Dashboard', '/', '/Auth']) {
      installWindow({ pathname, gtag: gtag.fn, search: '?plate=' + PLATE });
      trackVehicleCheckSubmit({
        formLocation: 'vehicle_check_page',
        resultStatus: 'found',
        plate: PLATE,
      });
    }
    expect(gtag.calls).toHaveLength(0);
  });

  it('sends the whitelist on /website/vehicle-check', () => {
    const gtag = viGtag();
    installWindow({
      pathname: '/website/vehicle-check',
      gtag: gtag.fn,
      search: '?plate=' + PLATE,
    });

    trackVehicleCheckSubmit({
      formLocation: 'home_form',
      resultStatus: 'found',
      plate: PLATE,
      input: PLATE,
      userId: 'user-1',
    });

    expect(gtag.calls).toEqual([[
      'event',
      'vehicle_check_submit',
      {
        page_path: '/website/vehicle-check',
        form_location: 'home_form',
        link_location: 'home_form',
        result_status: 'found',
      },
    ]]);
    const params = gtag.calls[0][2];
    expect(Object.keys(params).sort()).toEqual([
      'form_location',
      'link_location',
      'page_path',
      'result_status',
    ]);
    expect(JSON.stringify(params)).not.toContain(PLATE);
    expect(params.page_path).not.toContain('?');
  });

  it('uses vehicle_check_page and each allowed result status', () => {
    for (const resultStatus of ['found', 'not_found', 'error']) {
      const gtag = viGtag();
      installWindow({ pathname: '/website/vehicle-check', gtag: gtag.fn });
      trackVehicleCheckSubmit({
        formLocation: 'vehicle_check_page',
        resultStatus,
      });
      expect(gtag.calls[0][2]).toEqual({
        page_path: '/website/vehicle-check',
        form_location: 'vehicle_check_page',
        link_location: 'vehicle_check_page',
        result_status: resultStatus,
      });
    }
  });

  it('also sends on the /website path itself', () => {
    const gtag = viGtag();
    installWindow({ pathname: '/website', gtag: gtag.fn });
    trackVehicleCheckSubmit({
      formLocation: 'home_form',
      resultStatus: 'not_found',
    });
    expect(gtag.calls[0][2].page_path).toBe('/website');
    expect(gtag.calls[0][2].result_status).toBe('not_found');
  });

  it('drops an invalid result_status and still sends the other whitelist keys', () => {
    const gtag = viGtag();
    installWindow({ gtag: gtag.fn, search: '?q=' + PLATE });
    trackVehicleCheckSubmit({
      formLocation: 'vehicle_check_page',
      resultStatus: PLATE,
      plate: PLATE,
    });
    const params = gtag.calls[0][2];
    expect(Object.keys(params).sort()).toEqual([
      'form_location',
      'link_location',
      'page_path',
    ]);
    expect(params).not.toHaveProperty('result_status');
    expect(JSON.stringify(params)).not.toContain(PLATE);
    expect(Object.values(params).every(value => !/^\d+$/.test(value))).toBe(true);
  });

  it('does not send an unknown form location, even if it looks like a plate', () => {
    const gtag = viGtag();
    installWindow({ gtag: gtag.fn });
    trackVehicleCheckSubmit({
      formLocation: PLATE,
      resultStatus: 'found',
    });
    trackVehicleCheckSubmit({
      formLocation: 'home',
      resultStatus: 'found',
    });
    expect(gtag.calls).toHaveLength(0);
  });

  it('does not throw when gtag throws', () => {
    installWindow({
      gtag() {
        throw new Error('gtag failed');
      },
    });
    expect(() => trackVehicleCheckSubmit({
      formLocation: 'home_form',
      resultStatus: 'error',
      plate: PLATE,
    })).not.toThrow();
  });
});

function viGtag() {
  const calls = [];
  return {
    calls,
    fn(...args) {
      calls.push(args);
    },
  };
}
