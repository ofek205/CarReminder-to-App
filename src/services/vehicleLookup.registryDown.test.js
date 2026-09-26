import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lookupVehicleByPlate,
  isMainRegistryDown,
  isGovRegistryDownError,
  resetMainRegistryHealth,
} from '@/services/vehicleLookup';

/**
 * 2026-09-25: data.gov.il never loaded the ministry's private and
 * light-commercial registry after its upload; the searchable table sat at
 * 0 rows for over a day. Every ordinary car came back "not found", and the
 * app told users to check the number they typed. These pin the difference
 * between "no such vehicle" and "the ministry is down".
 */

const MAIN = '053cea08-09bc-40ec-8f7a-156f0677aff3';

// Every registry answers "nothing"; the main registry's size probe
// (limit=0) answers with `mainRows`, or fails when mainRows is 'fail'.
function mockGov({ mainRows, found } = {}) {
  const probes = [];
  const fetchMock = vi.fn(async (url) => {
    const u = new URL(String(url), 'https://data.gov.il');
    const rid = u.searchParams.get('resource_id');
    const ok = (result) => ({ ok: true, json: async () => ({ success: true, result }) });
    if (rid === MAIN && u.searchParams.get('limit') === '0') {
      probes.push(url);
      if (mainRows === 'fail') return { ok: false, status: 503, json: async () => ({}) };
      return ok({ total: mainRows, records: [] });
    }
    if (rid === MAIN && found) return ok({ records: [found] });
    return ok({ total: 0, records: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, probes };
}

beforeEach(() => resetMainRegistryHealth());
afterEach(() => vi.unstubAllGlobals());

describe('a full-length plate found nowhere', () => {
  it('throws "registry down" when the main registry is empty', async () => {
    mockGov({ mainRows: 0 });
    const err = await lookupVehicleByPlate('25908901').catch((e) => e);
    expect(isGovRegistryDownError(err)).toBe(true);
    expect(err.message).toBe('מאגר הרכבים של משרד התחבורה לא זמין כרגע');
  });

  it('throws "registry down" while it is still loading (under a million rows)', async () => {
    mockGov({ mainRows: 250_000 });
    const err = await lookupVehicleByPlate('25908901').catch((e) => e);
    expect(isGovRegistryDownError(err)).toBe(true);
  });

  it('is an ordinary "not found" when the registry is full', async () => {
    mockGov({ mainRows: 4_100_000 });
    await expect(lookupVehicleByPlate('25908901')).resolves.toBeNull();
  });

  it('is an ordinary "not found" when the size check itself fails: no evidence, no blame', async () => {
    mockGov({ mainRows: 'fail' });
    await expect(lookupVehicleByPlate('25908901')).resolves.toBeNull();
  });
});

describe('what the check must not touch', () => {
  it('a short plate (collector, צמ"ה) never asks: the main registry has no short plates', async () => {
    const { probes } = mockGov({ mainRows: 0 });
    await expect(lookupVehicleByPlate('229080')).resolves.toBeNull();
    expect(probes).toHaveLength(0);
  });

  it('a plate the main registry has is returned without asking', async () => {
    const { probes } = mockGov({
      mainRows: 0,
      found: { mispar_rechev: 25908901, tozeret_nm: 'פולקסווגן', degem_nm: 'GOLF', shnat_yitzur: 2017 },
    });
    const result = await lookupVehicleByPlate('25908901');
    expect(result).not.toBeNull();
    expect(isGovRegistryDownError(result)).toBe(false);
    expect(probes).toHaveLength(0);
  });
});

describe('the size check', () => {
  it('asks once per five minutes, so a bulk add of many plates probes once', async () => {
    const { probes } = mockGov({ mainRows: 0 });
    for (const p of ['25908901', '12345678', '87654321']) {
      await lookupVehicleByPlate(p).catch(() => {});
    }
    expect(probes).toHaveLength(1);
  });

  it('does not cache a failed check', async () => {
    const { probes } = mockGov({ mainRows: 'fail' });
    expect(await isMainRegistryDown()).toBe(false);
    expect(await isMainRegistryDown()).toBe(false);
    expect(probes).toHaveLength(2);
  });
});
