/**
 * Every createPageUrl('X') must name a page registered in pages.config.js.
 *
 * WHY THIS EXISTS: on 2026-09-10 the guest conversion CTA on /MyPlan pointed
 * at createPageUrl('AuthPage'). The COMPONENT is AuthPage; the registered
 * page name is 'Auth'. createPageUrl only prefixes a slash, so the link went
 * to /AuthPage and the button that asks a guest to sign up landed on
 * "העמוד לא נמצא". It shipped, and it was found by a human opening the screen.
 *
 * ⚠️ NOTHING IN THE TOOLCHAIN CAN SEE THIS. A page name is a STRING. eslint,
 * the build and every type check are blind to it, react-router renders the
 * catch-all instead of erroring, and the failure is silent unless someone
 * clicks that exact link. Same exposure as the RPC names pinned in
 * src/lib/rpcNames.test.js, and the same fix: assert it in the suite that
 * actually runs, in pre-push and in CI.
 *
 * Zero, not a baseline: the offender above was the only one out of 70
 * registered pages, so the correct number is zero and the repo already
 * satisfies it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';

/** Page names registered in pages.config.js, i.e. the keys of the PAGES map. */
function registeredPages() {
  const cfg = fs.readFileSync(path.join(SRC, 'pages.config.js'), 'utf8');
  // The map is written as `"Name": Component,` one per line.
  return new Set([...cfg.matchAll(/^\s*"([A-Za-z0-9 _-]+)":\s/gm)].map((m) => m[1]));
}

/** Every literal passed to createPageUrl, with the file that passes it. */
function createPageUrlTargets() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (/node_modules|[\\/]dist/.test(p)) continue;
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      if (/\.test\./.test(entry.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      // Only string literals. A computed argument cannot be checked here and
      // is deliberately skipped rather than guessed at.
      for (const m of src.matchAll(/createPageUrl\(\s*['"]([^'"]+)['"]/g)) {
        found.push({ name: m[1], file: p });
      }
    }
  };
  walk(SRC);
  return found;
}

describe('createPageUrl targets resolve to registered pages', () => {
  const pages = registeredPages();
  const targets = createPageUrlTargets();

  it('finds both sides, so a broken scan cannot pass vacuously', () => {
    // Without this, a regex that matched nothing would make the assertion
    // below trivially true, which is the failure mode of every whole-repo
    // check.
    expect(pages.size).toBeGreaterThan(50);
    expect(targets.length).toBeGreaterThan(50);
  });

  it('has no link pointing at an unregistered page', () => {
    const unresolved = targets
      .filter((t) => !pages.has(t.name))
      .map((t) => `createPageUrl('${t.name}') in ${t.file}`);

    expect(unresolved, [
      'These build a URL for a page that pages.config.js does not register.',
      'react-router will render the 404 catch-all, silently, until someone clicks it.',
      'Note the trap that caused this: the COMPONENT name is not the PAGE name',
      "(component AuthPage is registered as 'Auth').",
    ].join('\n')).toEqual([]);
  });
});
