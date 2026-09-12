/**
 * The prefetch in usePrefetchOfflineEssentials is only useful if it writes the
 * key the Documents page reads. Get that wrong and it fails SILENTLY: data is
 * fetched, cached under a key nothing looks at, and offline still shows an
 * empty list. Nothing errors. So the contract is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
// Imported explicitly rather than reached for as a global: eslint runs this
// file under the browser-globals config the rest of src/ uses, where `process`
// is undefined, and no-undef is an error here on purpose.
import { cwd } from 'node:process';
import { documentsListKey } from './queryKeys';

const SRC = path.join(cwd(), 'src');

// Whitespace-insensitive, so reformatting cannot make the guards below stop
// matching and silently pass.
const flatten = (s) => s.replace(/\s+/g, '');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('documentsListKey', () => {
  it('produces the page\'s default unfiltered key from accountId alone', () => {
    // What the prefetch passes: just the account. It must equal what the page
    // builds on a first visit with no vehicle filter and a non-driver user.
    expect(documentsListKey({ accountId: 'acc1' }))
      .toEqual(documentsListKey({
        accountId: 'acc1',
        vehicleId: null,
        restrictToDriverAssignments: false,
        driverAssignedVehicleIds: null,
      }));
  });

  it('hashes identically to the page\'s key, which is what React Query compares', () => {
    // React Query keys by JSON.stringify, so this is the comparison that
    // actually decides whether the prefetch is used.
    const prefetch = JSON.stringify(documentsListKey({ accountId: 'acc1' }));
    const page = JSON.stringify(documentsListKey({
      accountId: 'acc1', vehicleId: null, restrictToDriverAssignments: false, driverAssignedVehicleIds: null,
    }));
    expect(prefetch).toBe(page);
  });

  it('keeps a vehicle filter distinct from the unfiltered list', () => {
    // Otherwise a filtered view would read the full list, or vice versa.
    expect(documentsListKey({ accountId: 'acc1', vehicleId: 'v1' }))
      .not.toEqual(documentsListKey({ accountId: 'acc1' }));
  });

  it('keeps a restricted driver distinct, which is why they are not prefetched', () => {
    const driver = documentsListKey({
      accountId: 'acc1', restrictToDriverAssignments: true, driverAssignedVehicleIds: ['v1', 'v2'],
    });
    expect(driver).not.toEqual(documentsListKey({ accountId: 'acc1' }));
    expect(driver[4]).toBe('v1,v2');
  });

  it('separates accounts, so a workspace switch cannot read the wrong documents', () => {
    expect(documentsListKey({ accountId: 'acc1' })).not.toEqual(documentsListKey({ accountId: 'acc2' }));
  });

  it('starts with the "documents" prefix the invalidations rely on', () => {
    // Documents.jsx invalidates by the bare ['documents'] prefix in three
    // places; a renamed first element would silently stop matching.
    expect(documentsListKey({ accountId: 'acc1' })[0]).toBe('documents');
  });
});

/**
 * The six tests above exercise the builder against itself, so they all still
 * pass if a call site stops using it. That is the actual failure mode: the
 * prefetch and the page drift apart, and offline quietly shows an empty list
 * again. These two guard the call sites instead of the function.
 */
describe('documents key call sites', () => {
  const REQUIRED = [
    'src/pages/Documents.jsx',
    'src/hooks/usePrefetchOfflineEssentials.js',
  ];

  it('builds the documents query key from the shared builder on both sides', () => {
    const missing = REQUIRED.filter((rel) => {
      const source = readFileSync(path.join(cwd(), rel), 'utf8');
      return !flatten(source).includes('queryKey:documentsListKey(');
    });
    expect(missing).toEqual([]);
  });

  it('never addresses the documents list by an inline key, bypassing the builder', () => {
    // Prefix operations are expected and correct: a bare or partial
    // ['documents'] key is how invalidate/refetch/setQueriesData reach every
    // documents query at once. Only an EXACT key built by hand is drift, so
    // the prefix callers are skipped and the exact-key callers are not.
    const PREFIX_OPS = [
      'invalidateQueries', 'refetchQueries', 'removeQueries', 'cancelQueries',
      'setQueriesData', 'getQueriesData',
    ];
    const EXACT_USES = [
      "queryKey:['documents'",
      "setQueryData(['documents'",
      "getQueryData(['documents'",
    ];
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(cwd(), file).split(path.sep).join('/');
      if (rel === 'src/lib/queryKeys.js') continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
        const flat = flatten(line);
        if (!EXACT_USES.some((use) => flat.includes(use))) return;
        if (PREFIX_OPS.some((fn) => flat.includes(fn))) return;
        offenders.push(`${rel}:${n + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
