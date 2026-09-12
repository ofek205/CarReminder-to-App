/**
 * Pins the things the marketing preview HIDES, because every one of them is a
 * one-character edit away from leaking into the real app, and none of them
 * would fail loudly if it did.
 *
 * The preview runs the real app in an iframe, so by default it inherits every
 * piece of guest chrome: a plate-check form, a "these are sample vehicles"
 * strip, a "sign up to keep your data" button, and the legal footer. All four
 * were suppressed because inside a product tour the visitor has no data to
 * lose, nothing to sign up for, and the marketing page already carries the same
 * legal links directly below the device.
 *
 * The direction that matters is the REVERSE one. If a guard is dropped or its
 * condition inverted, a real guest quietly loses their fastest route to a first
 * vehicle, a data-loss warning, and privacy/terms links. Nothing throws. The
 * screen just renders slightly emptier than it should, forever.
 *
 * Source-level rather than rendered, because this project has no DOM testing
 * environment: vitest runs in node with no jsdom. Whitespace is flattened so
 * reformatting cannot make a guard stop matching and silently pass.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';

const read = (rel) => readFileSync(path.join(cwd(), rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, '');

const dashboard = flat(read('src/pages/Dashboard.jsx'));
const mainJsx = flat(read('src/main.jsx'));
const indexHtmlRaw = read('index.html');
const indexHtml = flat(indexHtmlRaw);
const layout = flat(read('src/Layout.jsx'));

describe('the preview hides what does not belong in a product tour', () => {
  it('gates the sample-vehicle notice and the signup prompt on demo mode', () => {
    // Both blocks hang off this single flag, so the guard lives at the
    // definition rather than being repeated at each JSX site.
    expect(dashboard).toContain('constisShowingDemo=!isDemoMode()&&');
  });

  it('gates the plate-check block on demo mode', () => {
    // ~430px, and the first thing in the document. Left in, the preview opens
    // on a form the visitor cannot use and buries the vehicle cards the copy
    // beside the frame is describing.
    expect(dashboard).toContain('{!isDemoMode()&&<VehicleCheckHero');
  });

  it('sets the html.cr-demo flag from the URL-derived demo flag', () => {
    expect(mainJsx).toContain("if(isDemoMode())document.documentElement.classList.add('cr-demo')");
  });

  it('hides the legal footer under that flag', () => {
    expect(indexHtml).toContain('html.cr-demo#cr-legal-footer{display:none;}');
  });

  it('still hides it for native builds, which is why the rule existed at all', () => {
    // The demo rule was added beside this one rather than inventing a second
    // mechanism. If this disappears, the pairing has been broken.
    expect(indexHtml).toContain('html.native-app#cr-legal-footer{display:none;}');
  });
});

describe('the guards that must NOT be over-applied', () => {
  it('keeps the legal footer markup in the shipped HTML', () => {
    // This is the reason the footer is hidden with CSS instead of removed from
    // the DOM: the markup ships so Google's OAuth consent crawler can read it.
    // Deleting the node would reclaim the same pixels and silently break
    // consent verification, which nobody notices until a login flow fails.
    expect(indexHtmlRaw).toContain('id="cr-legal-footer"');
    expect(indexHtmlRaw).toContain('/PrivacyPolicy');
    expect(indexHtmlRaw).toContain('/TermsOfService');
  });

  it('keeps the guest banner suppression scoped to demo mode', () => {
    // `isGuest && !demoMode`, not `!demoMode` alone: a real guest must still be
    // told they are in guest mode.
    expect(layout).toContain('{isGuest&&!demoMode&&<GuestBanner/>}');
  });

  it('derives demo mode from the URL alone', () => {
    // Not storage-backed and not settable by a component, so no XSS and no
    // stray state can flip a real session into the suppressed view.
    // Comments are stripped first: the file's own audit note EXPLAINS that a
    // historical localStorage key was the wrong approach, and matching that
    // sentence would fail the guard for saying the right thing.
    const withoutComments = read('src/lib/demoMode.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(flat(withoutComments)).toContain('initialPath===DEMO_ENTRY_PATH');
    expect(withoutComments).not.toMatch(/localStorage\.|sessionStorage\./);
  });
});
